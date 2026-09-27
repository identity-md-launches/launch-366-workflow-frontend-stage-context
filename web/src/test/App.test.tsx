import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { ACCOUNT, ETHER, OTHER, PAYOUT, setupEnv, type TestEnv } from "./setup";

const DAY = 86_400n;

// Transaction receipts arrive after the client's polling interval; allow for it.
configure({ asyncUtilTimeout: 15000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderApp() {
  const view = render(<App />);
  await screen.findByText("Contracts and configuration");
  return view;
}

/** Connect and wait until the post-connect refresh shows the wallet's balance. */
async function connect(balanceText = "100 MTCH") {
  fireEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));
  await screen.findByText("Sepolia");
  await screen.findAllByText(balanceText, { selector: "dd" });
}

/** Round 0 open now with two projects; the connected account holds 100 MTCH. */
function seedOpenRound(env: TestEnv) {
  const { chain } = env;
  chain.addRound(OTHER, chain.timestamp - DAY, chain.timestamp + 2n * DAY);
  chain.addProject(0n, PAYOUT);
  chain.addProject(0n, OTHER);
  chain.setBalance(ACCOUNT, 100n * ETHER);
}

describe("deployment configuration and disconnected state", () => {
  it("loads imd-deployment.json + ABIs, lists contracts, and keeps actions disabled", async () => {
    const env = setupEnv({ noWallet: true });
    await renderApp();

    const fetched = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]);
    expect(fetched).toContain("./imd-deployment.json");
    expect(fetched).toContain("./abi/LaunchToken.json");
    expect(fetched).toContain("./abi/QuadraticFunding.json");

    for (const c of env.manifest.contracts) {
      const link = screen.getByRole("link", { name: c.address });
      expect(link.getAttribute("href")).toBe(`https://sepolia.etherscan.io/address/${c.address}`);
    }
    expect(screen.getByText(/No browser wallet found/)).toBeTruthy();
    await screen.findByText("No rounds yet");
    expect((screen.getByRole("button", { name: "Create round" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Approve MTCH" }) as HTMLButtonElement).disabled).toBe(true);
    // Read-only quote through the manifest's quoter address.
    await screen.findByText(/0\.01 ETH ≈ 123\.45 MTCH/);
    expect(env.chain.requests.some((r) => r.method === "eth_call" && JSON.stringify(r.params).includes(env.chain.quoter))).toBe(true);
  });

  it("reports a manifest that cannot be loaded", async () => {
    setupEnv({ noWallet: true });
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "./imd-deployment.json") return new Response("gone", { status: 404 });
      return original(input, init);
    }) as typeof fetch;
    render(<App />);
    await screen.findByText(/Unable to load the deployment configuration/);
  });

  it("renders live rounds and projects from views without a wallet", async () => {
    const env = setupEnv({ noWallet: true });
    seedOpenRound(env);
    env.chain.rounds[0].pool = 50n * ETHER;
    await renderApp();
    await screen.findByRole("heading", { name: "Round 0" });
    expect(screen.getByText("Open for contributions")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Projects in round 0" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("link", { name: "0x3333…3333" })).toBeTruthy();
    // Paying forms exist but stay disabled while disconnected.
    const step1s = screen.getAllByRole("button", { name: "Step 1: Approve MTCH" }) as HTMLButtonElement[];
    expect(step1s).toHaveLength(2); // contribute + fund
    expect(step1s.every((b) => b.disabled)).toBe(true);
    expect(screen.getAllByText("Connect a wallet to take part.").length).toBeGreaterThan(0);
  });
});

describe("wallet connection and network switching", () => {
  it("offers Switch to Sepolia, adds the chain on 4902 with the manifest's parameters, then switches", async () => {
    const env = setupEnv({ walletChainId: 1 });
    await renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await screen.findByText("Wrong network (chain 1)");
    expect((screen.getByRole("button", { name: "Create round" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Switch to Sepolia" }));
    await screen.findByText("Sepolia");

    const methods = env.wallet.requests.map((r) => r.method);
    const firstSwitch = methods.indexOf("wallet_switchEthereumChain");
    const add = methods.indexOf("wallet_addEthereumChain");
    expect(firstSwitch).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(firstSwitch);
    expect(methods.lastIndexOf("wallet_switchEthereumChain")).toBeGreaterThan(add);
    expect(env.wallet.addedChains[0]).toEqual({
      chainId: "0xaa36a7",
      chainName: "Sepolia",
      rpcUrls: (env.manifest.network as { rpcUrls: string[] }).rpcUrls,
      nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
    });
    expect(screen.queryByRole("button", { name: "Switch to Sepolia" })).toBeNull();
    expect((screen.getByRole("button", { name: "Create round" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a rejection message when the user declines to connect or switch", async () => {
    const env = setupEnv({ walletChainId: 1 });
    await renderApp();
    env.wallet.rejectNext = "connect";
    fireEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));
    await screen.findByText("Connection request was rejected in the wallet.");
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText("Wrong network (chain 1)");
    env.wallet.rejectNext = "switch";
    fireEvent.click(screen.getByRole("button", { name: "Switch to Sepolia" }));
    await screen.findByText("Network switch was rejected in the wallet.");
  });

  it("shows the connected wallet's MTCH balance and allowance and disconnects", async () => {
    const env = setupEnv();
    env.chain.setBalance(ACCOUNT, 1234n * ETHER + 5n * 10n ** 17n);
    env.chain.setAllowance(ACCOUNT, 7n * ETHER);
    await renderApp();
    await connect("1,234.5 MTCH");
    expect(screen.getByText("7 MTCH")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await screen.findByRole("button", { name: "Connect wallet" });
  });
});

describe("paying actions require an explicit approval step", () => {
  it("contribute: approve for the exact amount, then contribute, with live state refresh", async () => {
    const env = setupEnv();
    seedOpenRound(env);
    await renderApp();
    await connect();
    await screen.findByRole("heading", { name: "Round 0" });

    const form = screen.getByRole("form", { name: "Contribute to a project" });
    const amount = within(form).getByLabelText("Amount (MTCH)");
    fireEvent.change(amount, { target: { value: "9" } });

    const step1 = within(form).getByRole("button", { name: "Step 1: Approve MTCH" }) as HTMLButtonElement;
    const step2 = within(form).getByRole("button", { name: "Step 2: Contribute" }) as HTMLButtonElement;
    expect(step1.disabled).toBe(false);
    expect(step2.disabled).toBe(true);
    expect(within(form).getByText(/approve 9 MTCH to unlock step 2/)).toBeTruthy();

    fireEvent.click(step1);
    await within(form).findByText(/Confirmed\./);
    const approve = env.chain.sent[0];
    expect(approve.to.toLowerCase()).toBe(env.chain.token.toLowerCase());
    expect(approve.functionName).toBe("approve");
    expect((approve.args[0] as string).toLowerCase()).toBe(env.chain.funding.toLowerCase());
    expect(approve.args[1]).toBe(9n * ETHER);
    expect(within(form).getByRole("link", { name: "View transaction on explorer" }).getAttribute("href")).toBe(
      `https://sepolia.etherscan.io/tx/${approve.hash}`,
    );

    await waitFor(() => expect((within(form).getByRole("button", { name: "Step 2: Contribute" }) as HTMLButtonElement).disabled).toBe(false));
    expect((within(form).getByRole("button", { name: "Step 1: Approve MTCH" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(form).getByLabelText("Project"), { target: { value: "1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Step 2: Contribute" }));
    await waitFor(() => expect(env.chain.sent).toHaveLength(2));
    const contribute = env.chain.sent[1];
    expect(contribute.to.toLowerCase()).toBe(env.chain.funding.toLowerCase());
    expect(contribute.functionName).toBe("contribute");
    expect(contribute.args).toEqual([0n, 1n, 9n * ETHER]);

    // Live reads after confirmation: balance, allowance, project row and estimate.
    await screen.findByText("91 MTCH");
    expect(screen.getAllByText("0 MTCH", { selector: "dd" }).length).toBeGreaterThan(0); // allowance used up
    const table = screen.getByRole("table", { name: "Projects in round 0" });
    const row = within(table).getAllByRole("row")[2];
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0x2222…2222", "9", "0", "9"]);
  });

  it("fund: any positive amount, approval gate, pool updates and estimated match appears", async () => {
    const env = setupEnv();
    seedOpenRound(env);
    env.chain.setAllowance(ACCOUNT, 1000n * ETHER);
    await renderApp();
    await connect();
    const form = await screen.findByRole("form", { name: "Fund the matching pool" });
    fireEvent.change(within(form).getByLabelText("Amount (MTCH)"), { target: { value: "0.5" } });
    expect((within(form).getByRole("button", { name: "Step 1: Approve MTCH" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(form).getByRole("button", { name: "Step 2: Fund pool" }));
    await within(form).findByText(/Confirmed\./);
    expect(env.chain.sent[0].functionName).toBe("fund");
    expect(env.chain.sent[0].args).toEqual([0n, 5n * 10n ** 17n]);
    await waitFor(() => expect(screen.getByText("0.5 MTCH", { selector: "dd" })).toBeTruthy());
  });

  it("validates on submit: amount under 1 MTCH, more than the balance, and malformed input", async () => {
    const env = setupEnv();
    seedOpenRound(env);
    await renderApp();
    await connect();
    const form = await screen.findByRole("form", { name: "Contribute to a project" });
    const amount = within(form).getByLabelText("Amount (MTCH)") as HTMLInputElement;

    fireEvent.change(amount, { target: { value: "0.5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Step 1: Approve MTCH" }));
    await within(form).findByText("At least 1 MTCH per payment.", { selector: ".field-error" });
    expect(amount.getAttribute("aria-invalid")).toBe("true");
    expect(amount.getAttribute("aria-describedby")).toContain(`${amount.id}-error`);

    fireEvent.change(amount, { target: { value: "500" } });
    fireEvent.click(within(form).getByRole("button", { name: "Step 1: Approve MTCH" }));
    await within(form).findByText(/This wallet holds 100 MTCH\. Enter that amount or less\./);

    fireEvent.change(amount, { target: { value: "1e5" } });
    fireEvent.submit(form);
    await within(form).findByText(/Enter an amount in MTCH/);
    expect(env.chain.sent).toHaveLength(0);
  });

  it("surfaces the contract's revert reason from simulation before the wallet opens", async () => {
    const env = setupEnv();
    seedOpenRound(env);
    env.chain.setAllowance(ACCOUNT, 1000n * ETHER);
    await renderApp();
    await connect();
    const form = await screen.findByRole("form", { name: "Contribute to a project" });
    fireEvent.change(within(form).getByLabelText("Amount (MTCH)"), { target: { value: "2" } });
    // The round ends between the page load and the click.
    env.chain.timestamp = env.chain.rounds[0].end + 1n;
    fireEvent.click(within(form).getByRole("button", { name: "Step 2: Contribute" }));
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain("Contributions are accepted only between the round's start and end.");
    expect(env.wallet.requests.some((r) => r.method === "eth_sendTransaction")).toBe(false);
  });

  it("reports a signature rejected in the wallet", async () => {
    const env = setupEnv();
    seedOpenRound(env);
    await renderApp();
    await connect();
    const form = await screen.findByRole("form", { name: "Contribute to a project" });
    fireEvent.change(within(form).getByLabelText("Amount (MTCH)"), { target: { value: "3" } });
    env.wallet.rejectNext = "tx";
    fireEvent.click(within(form).getByRole("button", { name: "Step 1: Approve MTCH" }));
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain("Signature request was rejected in the wallet.");
    fireEvent.click(within(form).getByRole("button", { name: "Dismiss" }));
    expect(within(form).queryByRole("alert")).toBeNull();
  });

  it("standalone approve in the wallet panel sets the allowance", async () => {
    const env = setupEnv();
    await renderApp();
    await connect("0 MTCH");
    fireEvent.change(screen.getByLabelText("Amount to approve (MTCH)"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve MTCH" }));
    await screen.findByText("250 MTCH");
    expect(env.chain.sent[0].functionName).toBe("approve");
    expect(env.chain.sent[0].args[1]).toBe(250n * ETHER);
  });
});

describe("round lifecycle controls", () => {
  it("creates a round with the chosen start and duration and shows creator-only registration", async () => {
    const env = setupEnv();
    await renderApp();
    await connect("0 MTCH");
    await screen.findByText("No rounds yet");
    const start = screen.getByLabelText("Start (local time)") as HTMLInputElement;
    // Chain time is far in the future relative to the wall clock; pick a start after it.
    const startDate = new Date(Number(env.chain.timestamp + 3600n) * 1000);
    startDate.setSeconds(0, 0); // datetime-local inputs carry minute precision
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}T${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
    fireEvent.change(start, { target: { value: local } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Create round" }));
    await screen.findByText(/Create a 10-day round:/);
    await screen.findByText(/Confirmed\./);
    await screen.findByRole("heading", { name: "Round 0" });
    const tx = env.chain.sent[0];
    expect(tx.functionName).toBe("createRound");
    const [s, e] = tx.args as [bigint, bigint];
    expect(e - s).toBe(10n * DAY);
    expect(s).toBe(BigInt(Math.floor(startDate.getTime() / 1000)));
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText(/Created by/).textContent).toContain("(you)");

    // Creator registers a project.
    const form = screen.getByRole("form", { name: "Register a project" });
    const payout = within(form).getByLabelText("Payout address");
    fireEvent.change(payout, { target: { value: "0x1234" } });
    fireEvent.click(within(form).getByRole("button", { name: "Register project" }));
    await within(form).findByText(/Enter a full 0x address/);
    fireEvent.change(payout, { target: { value: PAYOUT } });
    fireEvent.click(within(form).getByRole("button", { name: "Register project" }));
    await waitFor(() => expect(env.chain.sent).toHaveLength(2));
    expect(env.chain.sent[1].functionName).toBe("register");
    expect((env.chain.sent[1].args[1] as string).toLowerCase()).toBe(PAYOUT.toLowerCase());
    await screen.findByRole("table", { name: "Projects in round 0" });
  });

  it("rejects a start time in the past before asking the wallet", async () => {
    const env = setupEnv();
    await renderApp();
    await connect("0 MTCH");
    await screen.findByText("No rounds yet");
    fireEvent.change(screen.getByLabelText("Start (local time)"), { target: { value: "2001-01-01T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create round" }));
    await screen.findByText(/still in the future/);
    expect(env.chain.sent).toHaveLength(0);
  });

  it("hides registration from non-creators", async () => {
    const env = setupEnv();
    seedOpenRound(env); // created by OTHER
    await renderApp();
    await connect();
    await screen.findByRole("heading", { name: "Round 0" });
    expect(screen.queryByRole("form", { name: "Register a project" })).toBeNull();
  });

  it("finalizes an ended round, then the payout address claims once", async () => {
    const env = setupEnv({ account: PAYOUT });
    const { chain } = env;
    chain.addRound(OTHER, chain.timestamp - 3n * DAY, chain.timestamp - DAY);
    chain.addProject(0n, PAYOUT);
    chain.addProject(0n, OTHER);
    chain.rounds[0].pool = 100n * ETHER;
    // 16 MTCH contributed to project 0 by someone else → sumSqrt = 4e9.
    chain.project(0n, 0n).contributions = 16n * ETHER;
    chain.project(0n, 0n).sumSqrt = 4_000_000_000n;
    chain.rounds[0].totalContributions = 16n * ETHER;
    chain.setBalance(chain.funding, 116n * ETHER);

    await renderApp();
    await connect("0 MTCH");
    await screen.findByText("Ended, awaiting finalization");
    expect(screen.queryByRole("form", { name: "Contribute to a project" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finalize round" }));
    await screen.findByText("Finalized");
    expect(env.chain.sent[0].functionName).toBe("finalize");

    const claim = await screen.findByRole("button", { name: "Claim 116 MTCH" });
    fireEvent.click(claim);
    await screen.findByText("Claimed");
    expect(env.chain.sent[1].functionName).toBe("claim");
    expect(env.chain.sent[1].args).toEqual([0n, 0n]);
    await screen.findByText("116 MTCH", { selector: "dd" });
    expect(screen.getByText("Unclaimed")).toBeTruthy(); // project 1 belongs to OTHER
  });

  it("finalize reverts cleanly while the round is still open", async () => {
    const env = setupEnv();
    const { chain } = env;
    chain.addRound(OTHER, chain.timestamp - 3n * DAY, chain.timestamp - DAY);
    await renderApp();
    await connect("0 MTCH");
    await screen.findByText("Ended, awaiting finalization");
    chain.timestamp = chain.rounds[0].end - 10n; // the chain clock differs from the page's snapshot
    fireEvent.click(screen.getByRole("button", { name: "Finalize round" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The round has not ended yet.");
  });

  it("lets a funder reclaim when a finalized round had no contributions", async () => {
    const env = setupEnv();
    const { chain } = env;
    chain.addRound(OTHER, chain.timestamp - 3n * DAY, chain.timestamp - DAY);
    chain.rounds[0].pool = 40n * ETHER;
    chain.rounds[0].finalized = true;
    chain.rounds[0].refundable = true;
    chain.fundingOf.set(`0:${ACCOUNT.toLowerCase()}`, 40n * ETHER);
    chain.setBalance(chain.funding, 40n * ETHER);
    await renderApp();
    await connect("0 MTCH");
    await screen.findByText(/matching pool is refundable/);
    await screen.findByText("Your funding in this round: 40 MTCH.");
    fireEvent.click(screen.getByRole("button", { name: "Reclaim funding" }));
    await screen.findByText(/Confirmed\./);
    expect(env.chain.sent[0].functionName).toBe("reclaim");
    await screen.findByText("40 MTCH", { selector: ".stats:not(.stats-compact) dd" }); // wallet balance
    await waitFor(() => expect((screen.getByRole("button", { name: "Reclaim funding" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText("This wallet has nothing to reclaim in this round.")).toBeTruthy();
  });

  it("loads the round's activity from contract events on demand", async () => {
    const env = setupEnv({ noWallet: true });
    seedOpenRound(env);
    env.chain.addRound(OTHER, env.chain.timestamp, env.chain.timestamp + DAY); // unrelated round 1
    await renderApp();
    await screen.findByRole("heading", { name: "Round 0" });
    const card = screen.getByRole("article", { name: "Round 0" });
    const summary = within(card).getByText("Activity (from contract events)");
    fireEvent.click(summary);
    const details = summary.closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const list = await within(card).findByRole("list");
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("RoundCreated");
    expect(items[1]).toContain("Registered");
    expect(items[1]).toContain("project #0 paying 0x3333…3333");
  });
});
