"use client";

import { useEffect, useState, useCallback } from "react";
import { num, validateAndParseAddress, type WalletAccountV6 } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import styles from "./uni.module.css";
import SelectWallet from "./components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "./components/Wallet/walletContext";
import { useFrontendProvider } from "./components/client/provider/providerContext";
import * as constants from "../utils/constants";
import {
  Campaign,
  CAMPAIGN_STATUS,
  getCampaign,
  getCampaignCount,
  statusName,
  validateAddr,
  winnerCommitment,
  parseHelperEvents,
} from "../utils/campaigns";
import CampaignRegistrySierra from "../contracts/CampaignRegistry.sierra.json";
import CampaignRegistryCasm from "../contracts/CampaignRegistry.casm.json";
import PayoutHelperSierra from "../contracts/PayoutHelper.sierra.json";
import PayoutHelperCasm from "../contracts/PayoutHelper.casm.json";

// ─── formatting helpers ──────────────────────────────────────────────────────

function fmtStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function fmtDeadline(ts: bigint): string {
  const n = Number(ts);
  return new Date(n * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortHex(h: string): string {
  const hex = num.toHex(h);
  return hex.length <= 13 ? hex : `${hex.slice(0, 7)}…${hex.slice(-4)}`;
}

function prettyStatus(finality?: string, exec?: string): string {
  const f =
    finality === "ACCEPTED_ON_L2"
      ? "Accepted on L2"
      : finality === "ACCEPTED_ON_L1"
        ? "Accepted on L1"
        : finality === "RECEIVED"
          ? "Received"
          : "";
  const e = exec === "SUCCEEDED" ? "Succeeded" : exec === "REVERTED" ? "Reverted" : "";
  return [f, e].filter(Boolean).join(" · ") || "Confirmed";
}

// ─── types ───────────────────────────────────────────────────────────────────

type ResultRow = { label: string; value: string; hash?: string; ok?: boolean };
type ActionResult = {
  status: "pending" | "ok" | "error";
  title: string;
  rows?: ResultRow[];
  note?: string;
};

function receiptToResult(txR: any, txH: string): ActionResult {
  const r = txR?.value ?? txR;
  const exec: string | undefined = r?.execution_status;
  const finality: string | undefined = r?.finality_status;
  const reverted = exec === "REVERTED";
  let feeStr: string | undefined;
  const feeRaw = r?.actual_fee?.amount ?? r?.actual_fee;
  try {
    if (feeRaw !== undefined && feeRaw !== null) feeStr = `${fmtStrk(num.toBigInt(feeRaw))} STRK`;
  } catch { /* keep fee undefined */ }
  const rows: ResultRow[] = [
    { label: "Status", value: prettyStatus(finality, exec) },
  ];
  if (feeStr) rows.push({ label: "Network fee", value: feeStr });
  rows.push({ label: "Transaction", value: shortHex(txH), hash: txH });
  return {
    status: reverted ? "error" : "ok",
    title: reverted ? "Transaction reverted" : "Transaction confirmed",
    rows,
  };
}

function errorResult(msg: string): ActionResult {
  return { status: "error", title: "Action failed", note: msg };
}

export default function Page() {
  const myWalletAccount = useStoreWallet((s) => s.myWalletAccount);
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);

  const networkName = constants.Strk20Networks[myFrontendProviderIndex];
  const isStrk20Network = networkName !== undefined;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // create form
  const [rewardStrk, setRewardStrk] = useState("10");
  const [deadlineDays, setDeadlineDays] = useState("7");
  const [criteria, setCriteria] = useState("");
  const [resultCreate, setResultCreate] = useState<ActionResult | null>(null);

  // per-campaign results
  const [results, setResults] = useState<Record<number, ActionResult>>({});
  const [busy, setBusy] = useState<Record<number, string>>({});

  // shielded balance
  const [shielded, setShielded] = useState("");
  const [shieldAmount, setShieldAmount] = useState("10");
  const [shieldResult, setShieldResult] = useState<ActionResult | null>(null);
  const [shielding, setShielding] = useState(false);

  // deployment
  type Deployed = { registry: string; helper: string };
  const [deployed, setDeployed] = useState<Deployed>(() => {
    if (typeof window === "undefined") return { registry: "0x0", helper: "0x0" };
    try {
      const raw = localStorage.getItem("gameshield.addresses");
      if (raw) {
        const p = JSON.parse(raw);
        return { registry: p.registry ?? "0x0", helper: p.helper ?? "0x0" };
      }
    } catch {
      /* ignore */
    }
    return { registry: "0x0", helper: "0x0" };
  });
  const [deployState, setDeployState] = useState("");
  const [deployResult, setDeployResult] = useState<ActionResult | null>(null);
  const [manualRegistry, setManualRegistry] = useState("");
  const [manualHelper, setManualHelper] = useState("");

  const setResult = (id: number, r: ActionResult) =>
    setResults((prev) => ({ ...prev, [id]: r }));

  const setBusyFor = (id: number, what?: string) =>
    setBusy((prev) => {
      const next = { ...prev };
      if (what) next[id] = what;
      else delete next[id];
      return next;
    });

  const provider = constants.myFrontendProviders[myFrontendProviderIndex];
  const resolveAddr = (envAddr: string, storedAddr?: string) => {
    try {
      if (envAddr && num.toBigInt(envAddr) !== 0n) return envAddr;
    } catch {
      /* fall through */
    }
    try {
      if (storedAddr && num.toBigInt(storedAddr) !== 0n) return storedAddr;
    } catch {
      /* fall through */
    }
    return "0x0";
  };
  const registry = resolveAddr(constants.RegistryAddress, deployed.registry);
  const helper = resolveAddr(constants.HelperAddress, deployed.helper);
  const hasContracts = (() => {
    try {
      return num.toBigInt(registry) !== 0n && num.toBigInt(helper) !== 0n;
    } catch {
      return false;
    }
  })();

  const explorerTxUrl = (h: string) =>
    myFrontendProviderIndex === 0
      ? `https://voyager.online/tx/${h}`
      : `https://sepolia.voyager.online/tx/${h}`;

  // ─── campaign list ─────────────────────────────────────────────────────────

  const refreshCampaigns = useCallback(async () => {
    if (!hasContracts || !provider) return;
    setLoading(true);
    setError("");
    try {
      const count = await getCampaignCount(provider, registry);
      const all: Campaign[] = [];
      for (let id = 1; id <= count; id++) {
        all.push(await getCampaign(provider, registry, id));
      }
      setCampaigns(all.reverse());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [provider, registry, hasContracts]);

  useEffect(() => {
    refreshCampaigns();
  }, [refreshCampaigns, myFrontendProviderIndex]);

  // ─── private STRK20 submit ────────────────────────────────────────────────

  const refreshShielded = useCallback(async () => {
    if (!myWalletAccount) {
      setShielded("");
      return;
    }
    try {
      const bals = await myWalletAccount.strk20Balances([constants.addrSTRK]);
      const b = bals?.[0]?.balance;
      setShielded(b !== undefined && b !== null ? fmtStrk(num.toBigInt(b)) : "0");
    } catch {
      setShielded("0");
    }
  }, [myWalletAccount]);

  useEffect(() => {
    refreshShielded();
  }, [refreshShielded, myFrontendProviderIndex]);

  const handleShield = async (mode: "deposit" | "withdraw") => {
    if (!myWalletAccount || !connectedAddress) {
      setShieldResult(errorResult("Connect a wallet first."));
      return;
    }
    const amount = parseFloat(shieldAmount);
    if (!(amount > 0)) {
      setShieldResult(errorResult("Enter an amount > 0 STRK."));
      return;
    }
    setShielding(true);
    setShieldResult(null);
    try {
      const actions: WALLET_API.STRK20_ACTION[] =
        mode === "deposit"
          ? [{ type: "deposit", token: constants.addrSTRK, amount: num.toHex(BigInt(Math.round(amount * 1e18))) }]
          : [
              {
                type: "withdraw",
                token: constants.addrSTRK,
                amount: num.toHex(BigInt(Math.round(amount * 1e18))),
                recipient: connectedAddress,
              },
            ];
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      setShieldResult({
        status: "pending",
        title: "Waiting for confirmation…",
        rows: [
          { label: mode === "deposit" ? "Shield" : "Unshield", value: `${shieldAmount} STRK` },
          { label: "Transaction", value: shortHex(r.transaction_hash), hash: r.transaction_hash },
        ],
      });
      await provider.waitForTransaction(r.transaction_hash, { retries: 400, retryInterval: 3000 });
      setShieldResult(
        receiptToResult(await provider.getTransactionReceipt(r.transaction_hash), r.transaction_hash)
      );
      await refreshShielded();
    } catch (e: any) {
      setShieldResult(errorResult(e?.message ?? e?.toString?.() ?? String(e)));
    } finally {
      setShielding(false);
    }
  };

  async function submitPrivate(
    actions: WALLET_API.STRK20_ACTION[],
    id: number,
    label: string
  ): Promise<string | undefined> {
    if (!myWalletAccount) {
      setResult(id, errorResult("No WalletAccount available."));
      return undefined;
    }
    let txH: string;
    try {
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      txH = r.transaction_hash;
    } catch (e: any) {
      setResult(id, errorResult(e?.message ?? e?.toString?.() ?? String(e)));
      return undefined;
    }
    setResult(id, {
      status: "pending",
      title: "Waiting for confirmation…",
      rows: [{ label: label, value: "STRK" }, { label: "Transaction", value: shortHex(txH), hash: txH }],
    });
    try {
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const r = receiptToResult(txR, txH);
      // Attach privacy events of our helper for verification.
      const evs = parseHelperEvents(txR);
      if (evs.length) {
        const desc = evs
          .map((ev) => `${ev.name} (campaign ${ev.campaignId}, ${fmtStrk(ev.amount)} STRK)`)
          .join("; ");
        r.note = `Verified on-chain: ${desc}`;
      }
      setResult(id, r);
    } catch (e: any) {
      setResult(id, {
        status: "error",
        title: "Could not confirm transaction",
        rows: [{ label: "Transaction", value: shortHex(txH), hash: txH }],
        note: e?.message ?? e?.toString?.() ?? String(e),
      });
    }
    return txH;
  }

  async function submitPublic(
    calls: { contractAddress: string; entrypoint: string; calldata: string[] }[],
    id: number,
    title: string
  ) {
    if (!myWalletAccount) {
      setResult(id, errorResult("No WalletAccount available."));
      return;
    }
    let txH: string;
    try {
      const r = await myWalletAccount.execute(calls as any);
      txH = r.transaction_hash;
    } catch (e: any) {
      setResult(id, errorResult(e?.message ?? e?.toString?.() ?? String(e)));
      return;
    }
    setResult(id, {
      status: "pending",
      title: "Waiting for confirmation…",
      rows: [{ label: "Transaction", value: shortHex(txH), hash: txH }],
    });
    try {
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      setResult(id, receiptToResult(txR, txH));
      if (title.includes("Create")) await refreshCampaigns();
    } catch (e: any) {
      setResult(id, {
        status: "error",
        title: "Could not confirm transaction",
        rows: [{ label: "Transaction", value: shortHex(txH), hash: txH }],
        note: e?.message ?? e?.toString?.() ?? String(e),
      });
    }
    if (title.includes("Complete") || title.includes("Cancel")) await refreshCampaigns();
  }

  // ─── actions ──────────────────────────────────────────────────────────────

  // Declare + deploy both contracts with the connected wallet, then link the
  // helper to the registry. All steps are separate wallet transactions.
  const saveDeployed = (next: Deployed) => {
    setDeployed(next);
    try {
      localStorage.setItem("gameshield.addresses", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const handleSaveManual = () => {
    try {
      const reg = validateAndParseAddress(manualRegistry);
      const hel = validateAndParseAddress(manualHelper);
      saveDeployed({ registry: reg, helper: hel });
      setDeployResult({
        status: "ok",
        title: "Addresses saved",
        rows: [
          { label: "Registry", value: reg },
          { label: "Helper", value: hel },
        ],
      });
    } catch {
      setDeployResult(errorResult("Enter two valid Starknet addresses (0x…)."));
    }
  };

  const handleDeploy = async () => {
    if (!myWalletAccount || !connectedAddress) {
      setDeployResult(errorResult("Connect a wallet first."));
      return;
    }
    const wait = (h: string) =>
      provider.waitForTransaction(h, { retries: 400, retryInterval: 3000 });
    try {
      setDeployResult(null);

      setDeployState("Declaring CampaignRegistry…");
      const d1 = await myWalletAccount.declare({
        contract: { sierra: CampaignRegistrySierra, casm: CampaignRegistryCasm },
      } as any);
      await wait(d1.transaction_hash);
      const registryClassHash = d1.class_hash;

      setDeployState("Deploying CampaignRegistry…");
      const dep1 = await myWalletAccount.deploy({
        classHash: registryClassHash,
        constructorCalldata: [validateAddr(connectedAddress)],
      } as any);
      const registryAddress = dep1.contract_address as unknown as string;
      await wait(dep1.transaction_hash);

      setDeployState("Declaring PayoutHelper…");
      const d2 = await myWalletAccount.declare({
        contract: { sierra: PayoutHelperSierra, casm: PayoutHelperCasm },
      } as any);
      await wait(d2.transaction_hash);
      const helperClassHash = d2.class_hash;

      setDeployState("Deploying PayoutHelper…");
      const dep2 = await myWalletAccount.deploy({
        classHash: helperClassHash,
        constructorCalldata: [constants.PoolAddress, registryAddress],
      } as any);
      const helperAddress = dep2.contract_address as unknown as string;
      await wait(dep2.transaction_hash);

      setDeployState("Linking helper to registry…");
      const link = await myWalletAccount.execute([
        { contractAddress: registryAddress, entrypoint: "set_helper", calldata: [helperAddress] },
      ] as any);
      await wait(link.transaction_hash);

      saveDeployed({ registry: registryAddress, helper: helperAddress });
      setDeployResult({
        status: "ok",
        title: "Contracts deployed and linked",
        rows: [
          { label: "Registry", value: registryAddress },
          { label: "Helper", value: helperAddress },
        ],
        note: "Saved in this browser. Copy these addresses into .env (NEXT_PUBLIC_REGISTRY_ADDRESS / NEXT_PUBLIC_HELPER_ADDRESS) so all users see the same contracts.",
      });
    } catch (e: any) {
      setDeployResult(errorResult(e?.message ?? e?.toString?.() ?? String(e)));
    } finally {
      setDeployState("");
    }
  };

  const handleCreate = async () => {
    setResultCreate(null);
    const reward = BigInt(Math.round(parseFloat(rewardStrk) * 1e18));
    if (reward <= 0n) {
      setResultCreate(errorResult("Enter a reward > 0 STRK."));
      return;
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + parseInt(deadlineDays) * 86400);
    const criteriaHash = num.toHex(criteria || "no-criteria");
    const calls = [
      {
        contractAddress: registry,
        entrypoint: "create_campaign",
        calldata: [reward.toString(16), deadline.toString(16), criteriaHash],
      },
    ];
    if (!myWalletAccount) {
      setResultCreate(errorResult("Connect a wallet first."));
      return;
    }
    let txH: string;
    try {
      const r = await myWalletAccount.execute(calls as any);
      txH = r.transaction_hash;
    } catch (e: any) {
      setResultCreate(errorResult(e?.message ?? e?.toString?.() ?? String(e)));
      return;
    }
    setResultCreate({
      status: "pending",
      title: "Creating campaign…",
      rows: [{ label: "Transaction", value: shortHex(txH), hash: txH }],
    });
    try {
      await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      setResultCreate(receiptToResult(await provider.getTransactionReceipt(txH), txH));
      await refreshCampaigns();
    } catch (e: any) {
      setResultCreate(errorResult(e?.message ?? String(e)));
    }
  };

  // Fund: withdraw from the organizer's shielded note to the helper, open a note,
  // and invoke the helper's privacy_invoke(Fund). The helper passes the funds back
  // into the organizer's open note and emits Funded.
  const handleFund = async (c: Campaign) => {
    setBusyFor(c.id, "fund");
    try {
      const actions: WALLET_API.STRK20_ACTION[] = [
        { type: "withdraw", token: constants.addrSTRK, amount: num.toHex(c.rewardAmount), recipient: helper },
        { type: "transfer", token: constants.addrSTRK, amount: "OPEN", recipient: connectedAddress },
        {
          type: "invoke",
          contract: helper,
          calldata: ["0", num.toHex(c.id), num.toHex(constants.addrSTRK), num.toHex(c.rewardAmount), "0x0", "${openNoteIds[0]}"],
        },
      ];
      await submitPrivate(actions, c.id, "Funding campaign");
      await refreshCampaigns();
    } finally {
      setBusyFor(c.id);
    }
  };

  // Complete: the organizer commits the winner entitlement (a hash of campaign id
  // and winner address — the address itself never goes on-chain).
  const handleComplete = async (c: Campaign, winnerAddr: string) => {
    setBusyFor(c.id, "complete");
    try {
      const commitment = winnerCommitment(c.id, winnerAddr);
      await submitPublic(
        [
          {
            contractAddress: registry,
            entrypoint: "complete_campaign",
            calldata: [num.toHex(c.id), commitment],
          },
        ],
        c.id,
        "Complete campaign"
      );
      await refreshCampaigns();
    } finally {
      setBusyFor(c.id);
    }
  };

  // Payout: private STRK20 payout — the pool withdraws the reward to the helper,
  // the helper verifies the entitlement commitment, marks the campaign paid and
  // credits the winner's open note. No public link between bounty and winner.
  const handlePayout = async (c: Campaign, winnerAddr: string) => {
    setBusyFor(c.id, "payout");
    try {
      const commitment = winnerCommitment(c.id, winnerAddr);
      const actions: WALLET_API.STRK20_ACTION[] = [
        { type: "withdraw", token: constants.addrSTRK, amount: num.toHex(c.rewardAmount), recipient: helper },
        { type: "transfer", token: constants.addrSTRK, amount: "OPEN", recipient: validateAddr(winnerAddr) },
        {
          type: "invoke",
          contract: helper,
          calldata: ["1", num.toHex(c.id), num.toHex(constants.addrSTRK), num.toHex(c.rewardAmount), commitment, "${openNoteIds[0]}"],
        },
      ];
      await submitPrivate(actions, c.id, "Payout reward");
      await refreshCampaigns();
    } finally {
      setBusyFor(c.id);
    }
  };

  const handleCancel = async (c: Campaign) => {
    setBusyFor(c.id, "cancel");
    try {
      await submitPublic(
        [{ contractAddress: registry, entrypoint: "cancel_campaign", calldata: [num.toHex(c.id)] }],
        c.id,
        "Cancel campaign"
      );
      await refreshCampaigns();
    } finally {
      setBusyFor(c.id);
    }
  };

  // ─── render helpers ────────────────────────────────────────────────────────

  const ResultCard = ({ r }: { r: ActionResult }) => (
    <div
      className={`${styles.receipt} ${
        r.status === "error"
          ? styles.receiptError
          : r.status === "pending"
            ? styles.receiptPending
            : styles.receiptOk
      }`}
    >
      <div className={styles.receiptHead}>
        <span className={styles.receiptIcon}>
          {r.status === "ok" ? "✓" : r.status === "error" ? "!" : "⋯"}
        </span>
        <span>{r.title}</span>
      </div>
      {r.rows?.length ? (
        <div className={styles.receiptRows}>
          {r.rows.map((row) => (
            <div key={row.label} className={styles.receiptRow}>
              <span className={styles.receiptLabel}>{row.label}</span>
              {row.hash ? (
                <a className={styles.receiptLink} href={explorerTxUrl(row.hash)} target="_blank" rel="noreferrer">
                  {row.value} ↗
                </a>
              ) : (
                <span className={styles.receiptValue}>{row.value}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {r.note ? <pre className={styles.receiptNote}>{r.note}</pre> : null}
    </div>
  );

  const WinnerForm = ({ c }: { c: Campaign }) => {
    const [winner, setWinner] = useState("");
    const [winnerErr, setWinnerErr] = useState("");
    const isOrganizer = connectedAddress && validateAddr(connectedAddress) === c.organizer;
    const isActive = c.status === 0;
    const canPayout = isOrganizer && c.status === 1 && !c.paid;

    const submitWinner = (mode: "complete" | "payout") => {
      try {
        const addr = validateAndParseAddress(winner);
        setWinnerErr("");
        if (mode === "complete") handleComplete(c, addr);
        else handlePayout(c, addr);
      } catch {
        setWinnerErr("Enter a valid Starknet address (0x…).");
      }
    };

    return (
      <div className={styles.winnerRow}>
        <input
          className={styles.input}
          placeholder="Winner address 0x… (never published on-chain)"
          value={winner}
          onChange={(e) => setWinner(e.target.value)}
          disabled={busy[c.id] !== undefined}
        />
        <div className={styles.winnerBtns}>
          {isActive && isOrganizer && (
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
              disabled={busy[c.id] !== undefined}
              onClick={() => submitWinner("complete")}
            >
              {busy[c.id] === "complete" ? "…" : "Complete"}
            </button>
          )}
          {canPayout && (
            <button
              className={`${styles.btn} ${styles.btnGreen} ${styles.btnSmall}`}
              disabled={busy[c.id] !== undefined}
              onClick={() => submitWinner("payout")}
            >
              {busy[c.id] === "payout" ? "…" : "Private payout"}
            </button>
          )}
        </div>
        {winnerErr ? <span className={styles.winnerErr}>{winnerErr}</span> : null}
      </div>
    );
  };

  // ─── view ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.brand}>
          <span className={styles.brandBadge}>GS</span>
          <span className={styles.brandName}>GameShield</span>
        </div>
        <SelectWallet variant="nav" />
      </nav>

      <header className={styles.hero}>
        <span className={styles.eyebrow}>STRK20 Private Sprint 2026</span>
        <h1 className={styles.heroTitle}>
          Private Gaming
          <br />
          <span className={styles.heroAccent}>Bounty Hub</span>
        </h1>
        <p className={styles.heroSub}>
          Shield prize pools and pay winners through the STRK20 pool — no one can link
          a bounty, a reward, or a payout to a wallet.
        </p>
      </header>

      <main className={styles.main}>
        {/* Deploy / configure contracts */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Contracts</h2>
          <div className={styles.hint}>
            One-time setup on Mainnet (the STRK20 pool lives there). Deploy with your wallet
            or paste already-deployed addresses.
          </div>
          <div className={styles.formRow}>
            <button
              className={styles.btnCta}
              onClick={handleDeploy}
              disabled={!isConnected || deployState !== ""}
            >
              {deployState !== "" ? deployState : "Deploy contracts"}
            </button>
            <span className={styles.hint}>
              {hasContracts
                ? `registry ${shortHex(registry)} · helper ${shortHex(helper)}`
                : "not deployed yet"}
            </span>
          </div>
          <div className={styles.formRow}>
            <input
              className={styles.input}
              placeholder="Registry address 0x…"
              value={manualRegistry}
              onChange={(e) => setManualRegistry(e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Helper address 0x…"
              value={manualHelper}
              onChange={(e) => setManualHelper(e.target.value)}
            />
            <button className={`${styles.btn} ${styles.btnSmall}`} onClick={handleSaveManual}>
              Save
            </button>
          </div>
          {deployResult ? <ResultCard r={deployResult} /> : null}
        </section>

        {/* Shield / unshield */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Shielded STRK</h2>
          <div className={styles.hint}>
            Private balance in the pool: <b className={styles.mono}>{shielded} STRK</b> — shield
            STRK before funding a campaign.
          </div>
          <div className={styles.formRow}>
            <input
              className={styles.input}
              placeholder="Amount (STRK)"
              value={shieldAmount}
              onChange={(e) => setShieldAmount(e.target.value)}
            />
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
              disabled={!isConnected || shielding}
              onClick={() => handleShield("deposit")}
            >
              {shielding ? "…" : "Shield"}
            </button>
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
              disabled={!isConnected || shielding}
              onClick={() => handleShield("withdraw")}
            >
              {shielding ? "…" : "Unshield"}
            </button>
          </div>
          {!isConnected ? (
            <div className={styles.hint}>Connect a wallet to manage your shielded balance.</div>
          ) : null}
          {shieldResult ? <ResultCard r={shieldResult} /> : null}
        </section>

        {!hasContracts ? (
          <div className={styles.warn}>
            Contracts not configured. Deploy CampaignRegistry + PayoutHelper and set
            NEXT_PUBLIC_REGISTRY_ADDRESS / NEXT_PUBLIC_HELPER_ADDRESS, then restart.
          </div>
        ) : (
          <>
            {/* Create */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Create a bounty campaign</h2>
              <div className={styles.formRow}>
                <input
                  className={styles.input}
                  placeholder="Reward (STRK)"
                  value={rewardStrk}
                  onChange={(e) => setRewardStrk(e.target.value)}
                />
                <input
                  className={styles.input}
                  placeholder="Deadline (days)"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(e.target.value)}
                />
                <input
                  className={styles.input}
                  placeholder="Criteria (optional, e.g. tournament rules)"
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                />
                <button className={styles.btnCta} onClick={handleCreate} disabled={!isConnected}>
                  Create campaign
                </button>
              </div>
              {!isConnected ? (
                <div className={styles.hint}>Connect a wallet to create and manage campaigns.</div>
              ) : null}
              {resultCreate ? <ResultCard r={resultCreate} /> : null}
            </section>

            {/* List */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                Campaigns
                <button className={styles.refresh} onClick={refreshCampaigns} disabled={loading}>
                  {loading ? "…" : "↻"}
                </button>
              </h2>
              {error ? <div className={styles.warn}>{error}</div> : null}
              {!loading && !campaigns.length ? (
                <div className={styles.hint}>No campaigns yet. Create the first one above.</div>
              ) : null}
              {campaigns.map((c) => {
                const isOrganizer =
                  connectedAddress && validateAddr(connectedAddress) === c.organizer;
                const r = results[c.id];
                return (
                  <div key={c.id} className={styles.campaignCard}>
                    <div className={styles.campaignHead}>
                      <span className={styles.campaignId}>#{c.id}</span>
                      <span className={`${styles.statusPill} ${c.status === 0 ? styles.statusActive : c.status === 1 ? styles.statusDone : styles.statusCancel}`}>
                        {statusName(c.status)}
                        {c.paid ? " · paid" : ""}
                      </span>
                      <span className={styles.campaignOrg}>by {shortHex(c.organizer)}</span>
                    </div>
                    <div className={styles.campaignBody}>
                      <div className={styles.campaignMeta}>
                        <span>Reward</span>
                        <b>{fmtStrk(c.rewardAmount)} STRK</b>
                      </div>
                      <div className={styles.campaignMeta}>
                        <span>Deadline</span>
                        <b>{fmtDeadline(c.deadline)}</b>
                      </div>
                      <div className={styles.campaignMeta}>
                        <span>Criteria</span>
                        <b className={styles.mono}>{shortHex(c.criteriaHash)}</b>
                      </div>
                    </div>
                    <div className={styles.campaignActions}>
                      {isOrganizer && c.status === 0 && (
                        <button
                          className={`${styles.btn} ${styles.btnSmall}`}
                          disabled={busy[c.id] !== undefined}
                          onClick={() => handleFund(c)}
                        >
                          {busy[c.id] === "fund" ? "…" : "Fund (shield STRK)"}
                        </button>
                      )}
                      {isOrganizer && c.status === 0 && (
                        <button
                          className={`${styles.btn} ${styles.btnSmall}`}
                          disabled={busy[c.id] !== undefined}
                          onClick={() => handleCancel(c)}
                        >
                          {busy[c.id] === "cancel" ? "…" : "Cancel"}
                        </button>
                      )}
                    </div>
                    <WinnerForm c={c} />
                    {r ? <ResultCard r={r} /> : null}
                  </div>
                );
              })}
            </section>
          </>
        )}
      </main>

      <footer className={styles.footer}>
        <span>Powered by STRK20 privacy pool · Starknet.js v10.4</span>
        <span className={styles.footerDot}>·</span>
        <span>{networkName ?? "unknown network"}</span>
      </footer>
    </div>
  );
}