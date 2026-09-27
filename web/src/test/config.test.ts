import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { baseManifest, canonicalKeccak, loadDeploymentInputs } from "../../plugins/imd-deployment";
import { walletAddChainParams, type NetworkBlock } from "../config";
import { formatAmount, parseAmount } from "../lib/format";

const root = resolve(__dirname, "../..");

describe("deployment binding", () => {
  it("ABIs in docs/abi hash to the handoff's abiHash", () => {
    const handoff = JSON.parse(readFileSync(resolve(root, "deployment/handoff.json"), "utf8")) as {
      contracts: { name: string; abiHash: string }[];
    };
    for (const c of handoff.contracts) {
      const abi = JSON.parse(readFileSync(resolve(root, "../docs/abi", `${c.name}.json`), "utf8")) as unknown;
      expect(canonicalKeccak(abi)).toBe(c.abiHash);
    }
    expect(loadDeploymentInputs().abis.map((a) => a.name)).toEqual(["LaunchToken", "QuadraticFunding"]);
  });

  it("manifest copies identifiers, contracts and the network block from the handoff files", () => {
    const handoff = JSON.parse(readFileSync(resolve(root, "deployment/handoff.json"), "utf8")) as Record<string, unknown> & {
      contracts: { name: string; address: string; abiHash: string }[];
    };
    const networkFile = JSON.parse(readFileSync(resolve(root, "deployment/network.json"), "utf8")) as {
      network: unknown;
      walletAddChain: unknown;
    };
    const m = baseManifest();
    expect(m.version).toBe(1);
    expect(m.launchId).toBe(handoff.launchId);
    expect(m.chainId).toBe(handoff.chainId);
    expect(m.sourceCommit).toBe(handoff.sourceCommit);
    expect(m.attestationHash).toBe(handoff.attestationHash);
    expect(m.contracts).toEqual(
      handoff.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` })),
    );
    expect(JSON.stringify(m.network)).toBe(JSON.stringify(networkFile.network));
    // The add-chain request derived at runtime equals the handoff's walletAddChain block.
    expect(walletAddChainParams(m.network as NetworkBlock)).toEqual(networkFile.walletAddChain);
  });

  it("the committed export manifest, when present, matches the handoff", () => {
    let text: string;
    try {
      text = readFileSync(resolve(root, "../dist/imd-deployment.json"), "utf8");
    } catch {
      return; // not built yet
    }
    const dist = JSON.parse(text) as ReturnType<typeof baseManifest>;
    const expected = baseManifest();
    expect({ ...dist, assets: [] }).toEqual(expected);
    expect(dist.assets.some((a) => a.path === "index.html")).toBe(true);
    for (const c of dist.contracts) expect(dist.assets.some((a) => a.path === c.abiPath)).toBe(true);
    expect(dist.assets.some((a) => a.path === "imd-deployment.json")).toBe(false);
    for (const a of dist.assets) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("amount formatting", () => {
  it("formats base units with the token's decimals", () => {
    expect(formatAmount(0n, 18)).toBe("0");
    expect(formatAmount(10n ** 18n, 18)).toBe("1");
    expect(formatAmount(1_234_567n * 10n ** 15n, 18)).toBe("1,234.567");
    expect(formatAmount(15n * 10n ** 17n + 1n, 18)).toBe("1.5…");
    expect(formatAmount(1n, 18)).toBe("0.0000…");
  });
  it("parses typed amounts and rejects junk", () => {
    expect(parseAmount("2.5", 18)).toBe(25n * 10n ** 17n);
    expect(parseAmount("1,000", 18)).toBe(1000n * 10n ** 18n);
    expect(parseAmount("abc", 18)).toBeUndefined();
    expect(parseAmount("", 18)).toBeUndefined();
    expect(parseAmount("-1", 18)).toBeUndefined();
  });
});
