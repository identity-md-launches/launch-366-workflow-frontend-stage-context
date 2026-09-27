import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";
import type { Plugin } from "vite";

/**
 * Vite plugin that binds the app to the validated deployment handoff.
 *
 * Inputs (committed, copied verbatim from the workflow handoff):
 *   web/deployment/handoff.json  – .imd/reads/deployment.json
 *   web/deployment/network.json  – .imd/reads/network.json
 *   docs/abi/<Contract>.json     – implementation-derived ABIs at the pinned source commit
 *
 * Outputs (relative to dist/):
 *   abi/<Contract>.json          – raw ABI JSON array, canonical keccak checked against abiHash
 *   imd-deployment.json          – runtime deployment configuration + SHA-256 inventory of every
 *                                  other exported file (written after the bundle is on disk)
 *
 * In `vite dev` the same files are served from memory so the page never has a second copy of
 * addresses, chain settings or ABIs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const HANDOFF = join(webRoot, "deployment", "handoff.json");
const NETWORK = join(webRoot, "deployment", "network.json");
const ABI_DIR = join(repoRoot, "docs", "abi");

const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_BYTES = 24 * 1024 * 1024; // well under half of the checker's 64 MiB budget

interface HandoffContract {
  name: string;
  address: string;
  abiHash: string;
}
interface Handoff {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: HandoffContract[];
}

/** Canonical JSON: object keys sorted, no whitespace. Matches the handoff's canonicalKeccak. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalKeccak(abi: unknown): string {
  return keccak256(toHex(canonicalJson(abi))).slice(2);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Load handoff + network and the verified ABI text for every contract. */
export function loadDeploymentInputs() {
  const handoff = readJson<Handoff>(HANDOFF);
  const networkFile = readJson<{ network: unknown }>(NETWORK);
  const abis = handoff.contracts.map((c) => {
    if (!/^[A-Za-z0-9_]+$/.test(c.name)) throw new Error(`Unsafe contract name ${c.name}`);
    const text = readFileSync(join(ABI_DIR, `${c.name}.json`), "utf8");
    const abi = JSON.parse(text) as unknown;
    if (!Array.isArray(abi)) throw new Error(`${c.name} ABI is not a JSON array`);
    const hash = canonicalKeccak(abi);
    if (hash !== c.abiHash) {
      throw new Error(`ABI hash mismatch for ${c.name}: docs/abi gives ${hash}, handoff expects ${c.abiHash}`);
    }
    return { name: c.name, path: `abi/${c.name}.json`, text: JSON.stringify(abi) };
  });
  return { handoff, network: networkFile.network, abis };
}

/** Runtime configuration without the asset inventory (dev server and pre-hash stage). */
export function baseManifest() {
  const { handoff, network, abis } = loadDeploymentInputs();
  return {
    version: 1 as const,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({
      name: c.name,
      address: c.address,
      abiHash: c.abiHash,
      abiPath: abis.find((a) => a.name === c.name)!.path,
    })),
    assets: [] as { path: string; sha256: string }[],
    network,
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Write dist/imd-deployment.json listing every other exported file with its SHA-256. */
export function writeManifest(outDir: string) {
  const manifest = baseManifest();
  const files = walk(outDir)
    .map((f) => relative(outDir, f).split("\\").join("/"))
    .filter((p) => p !== "imd-deployment.json")
    .sort();
  let total = 0;
  manifest.assets = files.map((path) => {
    const bytes = readFileSync(join(outDir, path));
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} exceeds 8 MiB`);
    total += bytes.length;
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  if (manifest.assets.length > MAX_ASSETS) throw new Error(`Export has ${manifest.assets.length} assets (max ${MAX_ASSETS})`);
  if (total > MAX_EXPORT_BYTES) throw new Error(`Export is ${total} bytes, above the ${MAX_EXPORT_BYTES} byte budget`);
  for (const c of manifest.contracts) {
    if (!manifest.assets.some((a) => a.path === c.abiPath)) throw new Error(`ABI ${c.abiPath} missing from export`);
  }
  if (!manifest.assets.some((a) => a.path === "index.html")) throw new Error("index.html missing from export");
  writeFileSync(join(outDir, "imd-deployment.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export function imdDeployment(): Plugin {
  let outDir = "";
  return {
    name: "imd-deployment",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === "/imd-deployment.json") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(baseManifest(), null, 2));
          return;
        }
        const abi = url.startsWith("/abi/") ? loadDeploymentInputs().abis.find((a) => `/${a.path}` === url) : undefined;
        if (abi) {
          res.setHeader("content-type", "application/json");
          res.end(abi.text);
          return;
        }
        next();
      });
    },
    generateBundle() {
      for (const abi of loadDeploymentInputs().abis) {
        this.emitFile({ type: "asset", fileName: abi.path, source: abi.text });
      }
    },
    closeBundle() {
      if (!outDir) return;
      const manifest = writeManifest(outDir);
      const count = manifest.assets.length;
      // eslint-disable-next-line no-console
      console.log(`imd-deployment.json written with ${count} assets for chain ${manifest.chainId}`);
    },
  };
}
