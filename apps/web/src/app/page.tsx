"use client";

import { useEffect, useState, useCallback } from "react";
import { hash, num, validateAndParseAddress, type WalletAccountV6 } from "starknet";
import { getQuotes, executeSwap } from "@avnu/avnu-sdk";
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
} from "../utils/campaigns";
import {
  REWARD_TOKENS,
  tokenByAddress,
  formatTokenAmount,
  parseTokenAmount,
  symbolFor,
} from "../utils/tokens";
import {
  loadLedger,
  recordPoints,
  computeStats,
  swapPoints,
  POINTS_PER,
} from "../utils/points";
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

function parseStrkAmount(value: string): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,18}))?$/);
  if (!match) throw new Error("Enter a valid STRK amount with up to 18 decimals.");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(18, "0") || "0");
  const amount = whole * 10n ** 18n + fraction;
  if (amount <= 0n) throw new Error("Enter an amount > 0 STRK.");
  return amount;
}

function fmtDeadline(ts: bigint): string {
  const n = Number(ts);
  return new Date(n * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function defaultDeadline(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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

type CampaignMetadata = {
  version: 1;
  title: string;
  seats: number;
  description: string;
  deadline: string;
  reward: string;
  token: string;
  organizer: string;
  commitment: string;
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

function RatingPanel({ ledger }: { ledger: ReturnType<typeof loadLedger> }) {
  const stats = computeStats(ledger);
  const recent = ledger.slice(-5).reverse();
  return (
    <div className={styles.ratingGrid}>
      <div className={styles.ratingCard}>
        <span className={styles.ratingLabel}>Level</span>
        <b className={styles.ratingBig}>{stats.level}</b>
        {stats.nextLevel ? (
          <span className={styles.ratingSmall}>
            {stats.toNext} pts to {stats.nextLevel}
          </span>
        ) : (
          <span className={styles.ratingSmall}>max level</span>
        )}
      </div>
      <div className={styles.ratingCard}>
        <span className={styles.ratingLabel}>Points</span>
        <b className={styles.ratingBig}>{stats.total}</b>
        <span className={styles.ratingSmall}>
          {stats.base} base + {stats.streakBonus} streak
        </span>
      </div>
      <div className={styles.ratingCard}>
        <span className={styles.ratingLabel}>Swaps</span>
        <b className={styles.ratingBig}>{stats.swaps}</b>
        <span className={styles.ratingSmall}>
          ${stats.volumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} volume
        </span>
      </div>
      <div className={styles.ratingCard}>
        <span className={styles.ratingLabel}>Streak</span>
        <b className={styles.ratingBig}>{stats.streak}d</b>
        <span className={styles.ratingSmall}>{stats.activeDays} active days</span>
      </div>
      {recent.length ? (
        <ul className={styles.ratingRecent}>
          {recent.map((ev, i) => (
            <li key={i}>
              <span>{ev.label}</span>
              <b>+{ev.points}</b>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.hint}>No activity yet — swap, fund or payout to earn points.</div>
      )}
    </div>
  );
}

export default function Page() {
  const myWalletAccount = useStoreWallet((s) => s.myWalletAccount);
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);

  const networkName = constants.Strk20Networks[myFrontendProviderIndex];
  const isMainnet = myFrontendProviderIndex === 0;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // create form
  const [campaignTitle, setCampaignTitle] = useState("");
  const [rewardStrk, setRewardStrk] = useState("10");
  const [campaignToken, setCampaignToken] = useState(REWARD_TOKENS[0].address);
  const [deadlineAt, setDeadlineAt] = useState(defaultDeadline);
  const [seats, setSeats] = useState("32");
  const [description, setDescription] = useState("");
  const [campaignMetadata, setCampaignMetadata] = useState<Record<number, CampaignMetadata>>({});
  const [resultCreate, setResultCreate] = useState<ActionResult | null>(null);

  // per-campaign results
  const [results, setResults] = useState<Record<number, ActionResult>>({});
  const [busy, setBusy] = useState<Record<number, string>>({});

  // shielded balance
  const [shielded, setShielded] = useState("");
  const [shieldAmount, setShieldAmount] = useState("10");
  const [shieldToken, setShieldToken] = useState(REWARD_TOKENS[0].address);
  const [shieldResult, setShieldResult] = useState<ActionResult | null>(null);
  const [shielding, setShielding] = useState(false);

  // swap (AVNU)
  const [swapFromToken, setSwapFromToken] = useState(REWARD_TOKENS[1].address);
  const [swapToToken, setSwapToToken] = useState(REWARD_TOKENS[2].address);
  const [swapAmount, setSwapAmount] = useState("100");
  const [swapSlippage, setSwapSlippage] = useState(0.005);
  const [swapResult, setSwapResult] = useState<ActionResult | null>(null);
  const [swapping, setSwapping] = useState(false);

  // bridge
  const [bridgeResult, setBridgeResult] = useState<ActionResult | null>(null);

  // rating points
  const [ledger, setLedger] = useState<ReturnType<typeof loadLedger>>([]);

  const [showDev, setShowDev] = useState(false);

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

  const metadataStorageKey = `gameshield.campaign-metadata.${registry}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(metadataStorageKey);
      setCampaignMetadata(raw ? JSON.parse(raw) : {});
    } catch {
      setCampaignMetadata({});
    }
  }, [metadataStorageKey]);

  const saveCampaignMetadata = (campaignId: number, metadata: CampaignMetadata) => {
    setCampaignMetadata((current) => {
      const next = { ...current, [campaignId]: metadata };
      try {
        localStorage.setItem(metadataStorageKey, JSON.stringify(next));
      } catch {
        /* On-chain campaign creation must not fail because browser storage is unavailable. */
      }
      return next;
    });
  };

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
        const c = await getCampaign(provider, registry, id);
        if (c.status === 2) continue;
        all.push(c);
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

  // Hard refresh: bypass the browser cache so a stale JS bundle can never hide
  // on-chain state changes (e.g. campaigns cancelled in another tab/session).
  // A new query parameter forces the browser to re-fetch the HTML, which in
  // turn references the newest hashed JS chunks instead of cached ones.
  const hardRefresh = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("v", String(Date.now()));
      window.location.href = url.toString();
    } catch {
      window.location.reload();
    }
  };

  // ─── private STRK20 submit ────────────────────────────────────────────────

  const refreshShielded = useCallback(async () => {
    if (!myWalletAccount || !isMainnet) {
      setShielded("");
      return;
    }
    try {
      const bals = await myWalletAccount.strk20Balances([shieldToken]);
      const b = bals?.[0]?.balance;
      const decimals = tokenByAddress(shieldToken).decimals;
      setShielded(b !== undefined && b !== null ? formatTokenAmount(num.toBigInt(b), decimals) : "0");
    } catch {
      setShielded("0");
    }
  }, [myWalletAccount, isMainnet, shieldToken]);

  useEffect(() => {
    refreshShielded();
  }, [refreshShielded, myFrontendProviderIndex, shieldToken]);

  useEffect(() => {
    setLedger(loadLedger());
  }, []);

  const handleShield = async (mode: "deposit" | "withdraw") => {
    if (!myWalletAccount || !connectedAddress) {
      setShieldResult(errorResult("Connect a wallet first."));
      return;
    }
    if (!isMainnet) {
      setShieldResult(errorResult("STRK20 actions are available on Mainnet only."));
      return;
    }
    const tokenInfo = tokenByAddress(shieldToken);
    let amount: bigint;
    try {
      amount = parseTokenAmount(shieldAmount, tokenInfo.decimals);
    } catch (e: any) {
      setShieldResult(errorResult(e?.message ?? "Enter a valid amount."));
      return;
    }
    setShielding(true);
    setShieldResult(null);
    try {
      const actions: WALLET_API.STRK20_ACTION[] =
        mode === "deposit"
          ? [{ type: "deposit", token: shieldToken, amount: num.toHex(amount) }]
          : [
              {
                type: "withdraw",
                token: shieldToken,
                amount: num.toHex(amount),
                recipient: connectedAddress,
              },
            ];
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      setShieldResult({
        status: "pending",
        title: "Waiting for confirmation…",
        rows: [
          { label: mode === "deposit" ? "Shield" : "Unshield", value: `${shieldAmount} ${tokenInfo.symbol}` },
          { label: "Transaction", value: shortHex(r.transaction_hash), hash: r.transaction_hash },
        ],
      });
      await provider.waitForTransaction(r.transaction_hash, { retries: 400, retryInterval: 3000 });
      setShieldResult(
        receiptToResult(await provider.getTransactionReceipt(r.transaction_hash), r.transaction_hash)
      );
      await refreshShielded();
      setLedger(recordPoints({ kind: "shield", label: `${mode} ${shieldAmount} ${tokenInfo.symbol}`, points: POINTS_PER.shield }));
    } catch (e: any) {
      setShieldResult(errorResult(e?.message ?? e?.toString?.() ?? String(e)));
    } finally {
      setShielding(false);
    }
  };

  async function submitPrivate(
    actions: WALLET_API.STRK20_ACTION[],
    id: number,
    label: string,
    tokenSymbol?: string
  ): Promise<string | undefined> {
    if (!myWalletAccount) {
      setResult(id, errorResult("No WalletAccount available."));
      return undefined;
    }
    if (!isMainnet) {
      setResult(id, errorResult("STRK20 actions are available on Mainnet only."));
      return undefined;
    }
    let txH: string;
    try {
      setResult(id, {
        status: "pending",
        title: "Checking private transaction…",
        note: "The wallet is preparing and simulating the STRK20 proof before submission.",
      });
      try {
        await myWalletAccount.strk20PrepareInvoke(actions, true);
      } catch (preflightErr: any) {
        // Not all wallets implement the preflight method. Fall back to direct
        // submission (matching the official strk20-by-example flow); the wallet
        // still validates and proves the same actions itself.
        console.warn("STRK20 preflight skipped:", preflightErr?.message ?? preflightErr);
      }
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      txH = r.transaction_hash;
    } catch (e: any) {
      const message = e?.message ?? e?.toString?.() ?? String(e);
      setResult(id, errorResult(`STRK20 preflight or submission failed: ${message}`));
      return undefined;
    }
    setResult(id, {
      status: "pending",
      title: "Waiting for confirmation…",
      rows: [{ label: label, value: tokenSymbol ?? "STRK" }, { label: "Transaction", value: shortHex(txH), hash: txH }],
    });
    try {
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const r = receiptToResult(txR, txH);
      r.note = "Private STRK20 action confirmed. The reward moves through the pool — no public link between campaign and winner.";
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
    if (!isMainnet) {
      setResult(id, errorResult("GameShield contracts are deployed on Mainnet only."));
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

  const handleCheckWalletApi = async () => {
    if (!myWalletAccount) {
      setDeployResult(errorResult("Connect a wallet first."));
      return;
    }
    try {
      const api: any = await (myWalletAccount as any).supportedWalletApi?.();
      const specs: any = await (myWalletAccount as any).supportedSpecs?.();
      const methods: string[] = api?.methods ?? [];
      const declareOk = methods.includes("wallet_addDeclareTransaction");
      const deployOk = methods.includes("wallet_addDeployAccountTransaction");
      const strk20Methods = methods.filter((m) => m.includes("strk20"));
      const v6Methods = methods.filter((m) => m.includes("strk20") || m.includes("prepareInvoke"));
      setDeployResult({
        status: "ok",
        title: `Wallet API: declare ${declareOk ? "SUPPORTED" : "NOT SUPPORTED"}`,
        rows: [
          { label: "wallet_addDeclareTransaction", value: declareOk ? "yes" : "no" },
          { label: "wallet_addInvokeTransaction", value: methods.includes("wallet_addInvokeTransaction") ? "yes" : "no" },
          { label: "wallet_addDeployAccountTransaction", value: deployOk ? "yes" : "no" },
          { label: "wallet_strk20InvokeTransaction", value: methods.includes("wallet_strk20InvokeTransaction") ? "yes" : "no" },
          { label: "wallet_strk20PrepareInvoke", value: methods.includes("wallet_strk20PrepareInvoke") ? "yes" : "no" },
          { label: "wallet_strk20Balances", value: methods.includes("wallet_strk20Balances") ? "yes" : "no" },
          { label: "API versions", value: String(api?.versions ?? JSON.stringify(api ?? [])) },
          { label: "Specs", value: String(specs?.specs ?? JSON.stringify(specs ?? [])) },
          ...(strk20Methods.length
            ? [{ label: "Other strk20 methods", value: strk20Methods.join(", ") }]
            : []),
        ],
        note:
          v6Methods.length
            ? `STRK20 Wallet API methods advertised: ${v6Methods.join(", ")}.`
            : "Wallet does NOT advertise any strk20 methods — private actions (Fund/Payout) cannot work through this wallet's Wallet API.",
      });
    } catch (e: any) {
      setDeployResult(errorResult(e?.message ?? String(e)));
    }
  };

  // Probe: submit progressively larger action bundles to isolate which STRK20
  // action Ready X rejects. Each variant is a real wallet request.
  const probeVariant = async (actions: WALLET_API.STRK20_ACTION[], label: string) => {
    try {
      const r = await myWalletAccount!.strk20InvokeTransaction(actions);
      return { label, ok: true, value: `accepted — tx ${shortHex(r.transaction_hash)}` };
    } catch (e: any) {
      const message = e?.message ?? e?.toString?.() ?? String(e);
      const data = e?.data ?? e?.cause?.data;
      return { label, ok: false, value: message + (data ? ` — data: ${JSON.stringify(data)}` : "") };
    }
  };

  const handleProbeStrk20 = async () => {
    if (!myWalletAccount) {
      setDeployResult(errorResult("Connect a wallet first."));
      return;
    }
    setDeployResult({
      status: "pending",
      title: "Probing STRK20 action variants…",
      note: "Approve each popup, or reject; the probe records the wallet's response either way.",
    });
    const rows = [];
    const deposit1: WALLET_API.STRK20_ACTION[] = [
      { type: "deposit", token: constants.addrSTRK, amount: num.toHex(1n) },
    ];
    const transferAmount: WALLET_API.STRK20_ACTION[] = [
      { type: "transfer", token: constants.addrSTRK, amount: num.toHex(1n), recipient: connectedAddress },
    ];
    const withdraw1: WALLET_API.STRK20_ACTION[] = [
      { type: "withdraw", token: constants.addrSTRK, amount: num.toHex(1n), recipient: connectedAddress },
    ];
    const transferOpen: WALLET_API.STRK20_ACTION[] = [
      { type: "transfer", token: constants.addrSTRK, amount: "OPEN", recipient: connectedAddress },
    ];
    const noInvoke: WALLET_API.STRK20_ACTION[] = [
      { type: "withdraw", token: constants.addrSTRK, amount: num.toHex(1n), recipient: helper },
      { type: "transfer", token: constants.addrSTRK, amount: "OPEN", recipient: connectedAddress },
    ];
    const invokeOnly: WALLET_API.STRK20_ACTION[] = [
      {
        type: "invoke",
        contract: helper,
        calldata: ["0x0", num.toHex(1), num.toHex(constants.addrSTRK), num.toHex(1n), "0x0", "0x1"],
      },
    ];
    for (const [actions, label] of [
      [deposit1, "deposit 1 wei"],
      [transferAmount, "transfer 1 wei (no OPEN)"],
      [withdraw1, "withdraw 1 wei to self"],
      [transferOpen, "transfer OPEN"],
      [noInvoke, "withdraw + transfer OPEN"],
      [invokeOnly, "invoke helper (no OPEN)"],
    ] as const) {
      const r = await probeVariant(actions, label);
      rows.push({ label: r.label, value: r.value });
    }
    setDeployResult({
      status: "ok",
      title: "Probe results",
      rows,
      note: "If deposit/transfer-with-amount are accepted but OPEN variants are rejected, Ready X does not implement the OPEN literal yet. invoke-only tells us if invoke actions are supported at all.",
    });
  };

  const handleSaveManual = async () => {
    try {
      const reg = validateAndParseAddress(manualRegistry);
      const hel = validateAndParseAddress(manualHelper);
      const [registryClass, helperClass] = await Promise.all([
        provider.getClassHashAt(reg),
        provider.getClassHashAt(hel),
      ]);
      // v1 (STRK-only) and v2 (multi-token) class hashes are both accepted so
      // saved addresses from earlier deploys keep working.
      const knownRegistry = [
        "0x0043f1247fc09a89c13d776d13e8b6c7814d93193b64c0615e10238392edf038",
        "0x02f99b411abfa12ffc433bdb4b557dda5905b8fda37f6aa357a4e4ad92c530fc",
      ];
      const knownHelper = [
        "0x0725c73fdb163124aace8e665cdd1c0e4d0678e36e360d75b490d08906d62df0",
        "0x07d04f0a23b8e149041a98c0a8359927e1f0d72cea06f764e5c41ff2ca306d13",
      ];
      if (!knownRegistry.some((h) => num.toBigInt(registryClass) === num.toBigInt(h))) {
        throw new Error("Registry address is not a deployed CampaignRegistry contract.");
      }
      if (!knownHelper.some((h) => num.toBigInt(helperClass) === num.toBigInt(h))) {
        throw new Error("Helper address is not a deployed PayoutHelper contract.");
      }
      saveDeployed({ registry: reg, helper: hel });
      setDeployResult({
        status: "ok",
        title: "Addresses saved",
        rows: [
          { label: "Registry", value: reg },
          { label: "Helper", value: hel },
        ],
      });
    } catch (e: any) {
      setDeployResult(errorResult(e?.message ?? "Enter two valid GameShield contract addresses."));
    }
  };

  const handleResetManual = () => {
    saveDeployed({ registry: "0x0", helper: "0x0" });
    setManualRegistry("");
    setManualHelper("");
    setDeployResult({
      status: "ok",
      title: "Addresses cleared",
      note: "Now run Deploy contracts to create the real contracts with the connected wallet.",
    });
  };

  const handleLinkHelper = async () => {
    if (!myWalletAccount) {
      setDeployResult(errorResult("Connect a wallet first."));
      return;
    }
    if (!isMainnet) {
      setDeployResult(errorResult("Linking is available on Mainnet only."));
      return;
    }
    if (!registry || !helper || registry === "0x0" || helper === "0x0") {
      setDeployResult(errorResult("Save the Registry and Helper addresses first."));
      return;
    }
    setDeployState("Linking helper to registry…");
    try {
      const link = await myWalletAccount.execute([
        { contractAddress: registry, entrypoint: "set_helper", calldata: [helper] },
      ] as any);
      await provider.waitForTransaction(link.transaction_hash, { retries: 400, retryInterval: 3000 });
      setDeployResult({
        status: "ok",
        title: "Helper linked",
        rows: [
          { label: "Registry", value: registry },
          { label: "Helper", value: helper },
        ],
        note: "set_helper confirmed on-chain from your wallet.",
      });
    } catch (e: any) {
      setDeployResult(errorResult(e?.message ?? e?.toString?.() ?? String(e)));
    } finally {
      setDeployState("");
    }
  };

  // RPC contract_class must contain only the four spec fields (no debug info).
  const cleanClass = (c: any) => {
    const { sierra_program, contract_class_version, entry_points_by_type, abi } = c;
    return { sierra_program, contract_class_version, entry_points_by_type, abi };
  };

  const handleDeploy = async () => {
    if (!myWalletAccount || !connectedAddress) {
      setDeployResult(errorResult("Connect a wallet first."));
      return;
    }
    if (!isMainnet) {
      setDeployResult(errorResult("Deployment is available on Mainnet only."));
      return;
    }
    const wait = (h: string) =>
      provider.waitForTransaction(h, { retries: 400, retryInterval: 3000 });
    // WalletAccountV5.deploy may return contract_address as string[].
    const pickAddr = (v: unknown): string => {
      if (Array.isArray(v)) return String(v[0]);
      return String(v);
    };
    const verifyDeclared = async (classHash: string, label: string) => {
      try {
        await provider.getClass(classHash);
      } catch {
        throw new Error(`${label}: the wallet did not declare our class. Declared class hash (${classHash}) is not on-chain.`);
      }
    };
    const verifyDeployed = async (addr: string, classHash: string, label: string) => {
      try {
        const at = await provider.getClassHashAt(addr);
        if (num.toHex(at) !== num.toHex(classHash)) {
          throw new Error(
            `${label}: class at ${addr} is ${num.toHex(at)} but we deployed ${num.toHex(classHash)} — the wallet returned the wrong address.`
          );
        }
      } catch (e: any) {
        if (e?.message?.includes("class at")) throw e;
        throw new Error(`${label}: cannot verify deployment at ${addr} — ${e?.message ?? e}`);
      }
    };
    try {
      setDeployResult(null);

      setDeployState("Declaring CampaignRegistry…");
      const d1 = await myWalletAccount.declare({
        contract: cleanClass(CampaignRegistrySierra),
        casm: CampaignRegistryCasm,
      } as any);
      await wait(d1.transaction_hash);
      const registryClassHash = d1.class_hash;
      await verifyDeclared(registryClassHash, "CampaignRegistry");

      setDeployState("Deploying CampaignRegistry…");
      const dep1 = await myWalletAccount.deploy({
        classHash: registryClassHash,
        constructorCalldata: [validateAddr(connectedAddress)],
      } as any);
      const registryAddress = pickAddr(dep1.contract_address);
      await wait(dep1.transaction_hash);
      await verifyDeployed(registryAddress, registryClassHash, "CampaignRegistry");

      setDeployState("Declaring PayoutHelper…");
      const d2 = await myWalletAccount.declare({
        contract: cleanClass(PayoutHelperSierra),
        casm: PayoutHelperCasm,
      } as any);
      await wait(d2.transaction_hash);
      const helperClassHash = d2.class_hash;
      await verifyDeclared(helperClassHash, "PayoutHelper");

      setDeployState("Deploying PayoutHelper…");
      const dep2 = await myWalletAccount.deploy({
        classHash: helperClassHash,
        constructorCalldata: [constants.PoolAddress, registryAddress],
      } as any);
      const helperAddress = pickAddr(dep2.contract_address);
      await wait(dep2.transaction_hash);
      await verifyDeployed(helperAddress, helperClassHash, "PayoutHelper");

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
        note: "Verified on-chain: both classes declared and deployed at the addresses above. Copy them into .env (NEXT_PUBLIC_REGISTRY_ADDRESS / NEXT_PUBLIC_HELPER_ADDRESS) so all users see the same contracts.",
      });
    } catch (e: any) {
      setDeployResult(errorResult(e?.message ?? e?.toString?.() ?? String(e)));
    } finally {
      setDeployState("");
    }
  };

  const handleCreate = async () => {
    setResultCreate(null);
    if (!myWalletAccount || !connectedAddress) {
      setResultCreate(errorResult("Connect a wallet first."));
      return;
    }
    if (!isMainnet) {
      setResultCreate(errorResult("Campaigns are available on Mainnet only."));
      return;
    }
    let reward: bigint;
    let deadline: bigint;
    let seatCount: number;
    let criteriaHash: string;
    let metadata: CampaignMetadata;
    try {
      const title = campaignTitle.trim();
      const details = description.trim();
      if (title.length < 3 || title.length > 80) {
        throw new Error("Campaign title must be 3–80 characters.");
      }
      if (details.length < 20 || details.length > 2000) {
        throw new Error("Detailed description must be 20–2000 characters.");
      }
      reward = parseStrkAmount(rewardStrk);
      seatCount = Number(seats);
      if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 10000) {
        throw new Error("Number of places must be from 1 to 10,000.");
      }
      const deadlineDate = new Date(deadlineAt);
      if (Number.isNaN(deadlineDate.getTime())) {
        throw new Error("Choose a valid campaign end date and time.");
      }
      if (deadlineDate.getTime() < Date.now() + 5 * 60_000) {
        throw new Error("Campaign must end at least 5 minutes from now.");
      }
      deadline = BigInt(Math.floor(deadlineDate.getTime() / 1000));
      const tokenInfo = tokenByAddress(campaignToken);
      const metadataPayload = {
        version: 1 as const,
        title,
        seats: seatCount,
        description: details,
        deadline: deadline.toString(),
        reward: reward.toString(),
        token: tokenInfo.symbol,
        organizer: validateAddr(connectedAddress),
      };
      criteriaHash = num.toHex(hash.starknetKeccak(JSON.stringify(metadataPayload)));
      metadata = { ...metadataPayload, commitment: criteriaHash };
    } catch (e: any) {
      setResultCreate(errorResult(e?.message ?? "Enter valid campaign details."));
      return;
    }
    const calls = [
      {
        contractAddress: registry,
        entrypoint: "create_campaign",
        calldata: [num.toHex(reward), num.toHex(deadline), criteriaHash, campaignToken],
      },
    ];
    setResultCreate({
      status: "pending",
      title: "Checking campaign contract…",
      note: "Running a read-only Mainnet simulation before opening the wallet.",
    });
    try {
      await provider.callContract(calls[0]);
    } catch (e: any) {
      setResultCreate(errorResult(`Campaign contract simulation failed: ${e?.message ?? String(e)}`));
      return;
    }
    let txH: string;
    try {
      const r = await myWalletAccount.execute(calls as any);
      txH = r.transaction_hash;
    } catch (e: any) {
      const message = e?.message ?? e?.toString?.() ?? String(e);
      setResultCreate(errorResult(
        `The campaign contract simulation succeeded, but the wallet did not submit the transaction. ` +
        `Ready X fee review can fail for newly deployed custom contracts. Reload, reconnect on Mainnet, ` +
        `and retry; if it repeats, use another compatible Starknet wallet. Wallet error: ${message}`
      ));
      return;
    }
    setResultCreate({
      status: "pending",
      title: "Creating campaign…",
      rows: [{ label: "Transaction", value: shortHex(txH), hash: txH }],
    });
    try {
      await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const receipt: any = await provider.getTransactionReceipt(txH);
      const events: any[] = receipt?.events ?? receipt?.value?.events ?? [];
      const createdSelector = num.toHex(hash.getSelectorFromName("CampaignCreated"));
      const created = events.find((event) =>
        num.toHex(event.from_address ?? "0x0") === num.toHex(registry) &&
        num.toHex(event.keys?.[0] ?? "0x0") === createdSelector
      );
      const campaignId = created?.keys?.[1]
        ? Number(num.toBigInt(created.keys[1]))
        : await getCampaignCount(provider, registry);
      saveCampaignMetadata(campaignId, metadata);
      const result = receiptToResult(receipt, txH);
      result.note = `Campaign #${campaignId} created. Full details are stored locally and verified by on-chain commitment ${shortHex(criteriaHash)}.`;
      setResultCreate(result);
      setCampaignTitle("");
      setDescription("");
      await refreshCampaigns();
      setLedger(recordPoints({ kind: "campaign", label: `Create campaign #${campaignId}`, points: POINTS_PER.campaign }));
    } catch (e: any) {
      setResultCreate(errorResult(e?.message ?? String(e)));
    }
  };

  // Fund: the organizer privately deposits the reward into the pool. The pool
  // holds it as a shielded note owned by the organizer — no public link between
  // campaign and funds.
  const handleFund = async (c: Campaign) => {
    setBusyFor(c.id, "fund");
    try {
      const actions: WALLET_API.STRK20_ACTION[] = [
        { type: "deposit", token: c.token, amount: num.toHex(c.rewardAmount) },
      ];
      await submitPrivate(actions, c.id, "Funding campaign", symbolFor(c.token));
      await refreshCampaigns();
      setLedger(recordPoints({ kind: "fund", label: `Fund campaign #${c.id}`, points: POINTS_PER.fund }));
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

  // Payout: private STRK20 payout — the organizer's shielded note is transferred
  // straight to the winner's shielded balance. The pool never reveals amounts or
  // the link between the bounty and the winner.
  const handlePayout = async (c: Campaign, winnerAddr: string) => {
    setBusyFor(c.id, "payout");
    try {
      const commitment = winnerCommitment(c.id, winnerAddr);
      const actions: WALLET_API.STRK20_ACTION[] = [
        { type: "transfer", token: c.token, amount: num.toHex(c.rewardAmount), recipient: validateAddr(winnerAddr) },
      ];
      await submitPrivate(actions, c.id, "Payout reward", symbolFor(c.token));
      await refreshCampaigns();
      setLedger(recordPoints({ kind: "payout", label: `Payout campaign #${c.id}`, points: POINTS_PER.payout }));
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

  // ─── swap (AVNU) ───────────────────────────────────────────────────────────

  const handleSwap = async () => {
    if (!myWalletAccount || !connectedAddress) {
      setSwapResult(errorResult("Connect a wallet first."));
      return;
    }
    if (!isMainnet) {
      setSwapResult(errorResult("Swaps are available on Mainnet only."));
      return;
    }
    const fromInfo = tokenByAddress(swapFromToken);
    const toInfo = tokenByAddress(swapToToken);
    let sellAmount: bigint;
    try {
      sellAmount = parseTokenAmount(swapAmount, fromInfo.decimals);
    } catch (e: any) {
      setSwapResult(errorResult(e?.message ?? "Enter a valid swap amount."));
      return;
    }
    if (num.toHex(swapFromToken) === num.toHex(swapToToken)) {
      setSwapResult(errorResult("Choose two different tokens."));
      return;
    }
    setSwapping(true);
    setSwapResult({
      status: "pending",
      title: "Finding the best route on AVNU…",
      note: "Quotes are fetched with GameShield's 0.25% integrator fee included.",
    });
    try {
      const [quote] = await getQuotes({
        sellTokenAddress: swapFromToken,
        buyTokenAddress: swapToToken,
        sellAmount,
        takerAddress: connectedAddress,
        integratorFees: BigInt(constants.AVNU_FEE_BPS),
        integratorFeeRecipient: constants.AVNU_FEE_RECIPIENT,
        integratorName: constants.AVNU_INTEGRATOR_NAME,
      });
      if (!quote) {
        setSwapResult(errorResult("No liquidity route found for this pair and amount."));
        return;
      }
      setSwapResult({
        status: "pending",
        title: "Waiting for wallet confirmation…",
        rows: [
          { label: "Swap", value: `${swapAmount} ${fromInfo.symbol} → ${formatTokenAmount(num.toBigInt(quote.buyAmount), toInfo.decimals)} ${toInfo.symbol}` },
          { label: "GameShield fee", value: `0.25% (${constants.AVNU_FEE_BPS} bps)` },
          { label: "Route", value: quote.routes.map((r) => `${r.percent}% ${r.name}`).join(" · ") },
        ],
      });
      const result = await executeSwap({
        provider: myWalletAccount,
        quote,
        slippage: swapSlippage,
      });
      const txH = result.transactionHash;
      setSwapResult({
        status: "pending",
        title: "Waiting for confirmation…",
        rows: [{ label: "Transaction", value: shortHex(txH), hash: txH }],
      });
      await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      setSwapResult(receiptToResult(await provider.getTransactionReceipt(txH), txH));
      const usd = Number(quote.buyAmountInUsd ?? quote.sellAmountInUsd ?? 0);
      setLedger(
        recordPoints({
          kind: "swap",
          label: `Swap ${swapAmount} ${fromInfo.symbol} → ${toInfo.symbol}`,
          usd,
          points: swapPoints(usd),
        })
      );
    } catch (e: any) {
      setSwapResult(errorResult(e?.message ?? e?.toString?.() ?? String(e)));
    } finally {
      setSwapping(false);
    }
  };

  // ─── bridge ────────────────────────────────────────────────────────────────

  const handleBridgeOpen = (url: string, name: string) => {
    try {
      const link =
        name === "Layerswap"
          ? `${url}?sourceNetwork=ethereum&destinationNetwork=starknet_mainnet&destination=${connectedAddress ?? ""}`
          : url;
      window.open(link, "_blank", "noopener,noreferrer");
      setBridgeResult({
        status: "ok",
        title: `Opening ${name}`,
        note: "Complete the transfer on the provider's site, then shield the received funds here.",
      });
      setLedger(recordPoints({ kind: "bridge", label: `Bridge via ${name}`, points: POINTS_PER.bridge }));
    } catch (e: any) {
      setBridgeResult(errorResult(e?.message ?? String(e)));
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
    if (!isOrganizer || (!isActive && !canPayout)) return null;

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
      <nav className={styles.topbar}>
        <div className={styles.nav}>
          <a className={styles.brand} href="https://starknet-gaming.com/" target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.brandBadge} src="/brand/starknet-gaming.png" alt="Starknet Gaming" />
            <span className={styles.brandCopy}>
              <span className={styles.brandParent}>Starknet Gaming</span>
              <span className={styles.brandName}>GameShield</span>
            </span>
          </a>
          <div className={styles.navActions}>
            <a className={styles.navLink} href="#how-it-works">How it works</a>
            <a className={styles.navLink} href="#campaigns">Campaigns</a>
            <SelectWallet variant="nav" />
          </div>
        </div>
      </nav>

      <header className={styles.hero}>
        <span className={styles.eyebrow}>STRK20 Private Sprint 2026</span>
        <h1 className={styles.heroTitle}>
          Private Rewards
          <br />
          <span className={styles.heroAccent}>for Onchain Games</span>
        </h1>
        <p className={styles.heroSub}>
          Gaming rewards are usually public. GameShield lets games distribute rewards
          privately using STRK20 shielded notes — without publishing who won.
        </p>
      </header>

      <main className={styles.main}>
        <section className={styles.workflow} id="how-it-works">
          <div className={styles.workflowHead}>
            <span className={styles.eyebrow}>How it works</span>
            <h2>Three actions, private rewards</h2>
            <p>Non-custodial MVP — GameShield coordinates gaming bounties and enables private
            STRK20 reward delivery. Funds are not held in escrow.</p>
          </div>
          <div className={styles.workflowGrid}>
            <article className={styles.workflowStep}><span>01</span><h3>Create bounty</h3><p>Connect a wallet and publish a gaming bounty: public reward, deadline and campaign ID.</p></article>
            <article className={styles.workflowStep}><span>02</span><h3>Submit / select winner</h3><p>The organizer commits the winning address as a hash — the plaintext address never goes on-chain.</p></article>
            <article className={styles.workflowStep}><span>03</span><h3>Private payout</h3><p>Deliver the reward as a STRK20 shielded note. Only the winner can reveal the payout.</p></article>
          </div>
        </section>

        {/* Deploy / configure contracts — hidden in Developer settings */}
        {showDev ? (
        <details className={styles.advancedPanel} open>
          <summary>Developer settings</summary>
          <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Contract configuration</h2>
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
            <button className={`${styles.btn} ${styles.btnSmall}`} onClick={handleResetManual}>
              Reset
            </button>
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
              onClick={handleLinkHelper}
              disabled={!isConnected || deployState !== ""}
            >
              Link helper
            </button>
            <button className={`${styles.btn} ${styles.btnSmall}`} onClick={handleCheckWalletApi}>
              Wallet API check
            </button>
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
              onClick={handleProbeStrk20}
              disabled={!isConnected || !isMainnet}
            >
              Probe STRK20
            </button>
          </div>
          {deployResult ? <ResultCard r={deployResult} /> : null}
          </section>
        </details>
        ) : null}

        {/* Shield / unshield */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Shielded balance</h2>
          <div className={styles.hint}>
            Private balance in the pool: <b className={styles.mono}>{shielded} {symbolFor(shieldToken)}</b> — shield
            tokens before funding or paying out a campaign.
          </div>
          <div className={styles.formRow}>
            <select
              className={styles.input}
              value={shieldToken}
              onChange={(e) => setShieldToken(e.target.value)}
            >
              {REWARD_TOKENS.map((t) => (
                <option key={t.address} value={t.address}>{t.symbol} — {t.name}</option>
              ))}
            </select>
            <input
              className={styles.input}
              placeholder={`Amount (${symbolFor(shieldToken)})`}
              value={shieldAmount}
              onChange={(e) => setShieldAmount(e.target.value)}
            />
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
                disabled={!isConnected || !isMainnet || shielding}
              onClick={() => handleShield("deposit")}
            >
              {shielding ? "…" : "Shield"}
            </button>
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
                disabled={!isConnected || !isMainnet || shielding}
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

        {/* Swap (AVNU) */}
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Swap</span>
              <h2 className={styles.sectionTitle}>Swap any token</h2>
            </div>
            <p>Best-price routing across all Starknet liquidity via AVNU. GameShield adds a small
            0.25% integrator fee that helps keep this sprint alive.</p>
          </div>
          <div className={styles.formRow}>
            <select
              className={styles.input}
              value={swapFromToken}
              onChange={(e) => setSwapFromToken(e.target.value)}
            >
              {REWARD_TOKENS.map((t) => (
                <option key={t.address} value={t.address}>{t.symbol}</option>
              ))}
            </select>
            <span className={styles.hint}>→</span>
            <select
              className={styles.input}
              value={swapToToken}
              onChange={(e) => setSwapToToken(e.target.value)}
            >
              {REWARD_TOKENS.map((t) => (
                <option key={t.address} value={t.address}>{t.symbol}</option>
              ))}
            </select>
            <input
              className={styles.input}
              placeholder="Amount to sell"
              value={swapAmount}
              onChange={(e) => setSwapAmount(e.target.value)}
            />
            <select
              className={styles.input}
              value={String(swapSlippage)}
              onChange={(e) => setSwapSlippage(Number(e.target.value))}
            >
              <option value="0.005">0.5% slippage</option>
              <option value="0.01">1% slippage</option>
              <option value="0.03">3% slippage</option>
            </select>
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
              disabled={!isConnected || !isMainnet || swapping}
              onClick={handleSwap}
            >
              {swapping ? "…" : "Swap"}
            </button>
          </div>
          <div className={styles.hint}>
            <b className={styles.mono}>{constants.AVNU_FEE_BPS} bps</b> integrator fee goes to
            GameShield on every swap. Topping up swap tokens is a bridge away — see below.
          </div>
          {swapResult ? <ResultCard r={swapResult} /> : null}
        </section>

        {/* Bridge */}
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Bridge</span>
              <h2 className={styles.sectionTitle}>Fund your wallet from anywhere</h2>
            </div>
            <p>Move funds onto Starknet with the most popular bridges. Pick a provider — the page
            opens with your wallet address pre-filled where supported.</p>
          </div>
          <div className={styles.formRow}>
            {constants.BRIDGE_PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`${styles.btn} ${styles.btnSmall}`}
                onClick={() => handleBridgeOpen(p.url, p.name)}
                title={p.note}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className={styles.hint}>
            {constants.BRIDGE_PROVIDERS.map((p) => `${p.name}: ${p.fee}`).join(" · ")} ·
            StarkGate is the official bridge with no fees.
          </div>
          {bridgeResult ? <ResultCard r={bridgeResult} /> : null}
        </section>

        {/* Rating */}
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Rating</span>
              <h2 className={styles.sectionTitle}>Your GameShield points</h2>
            </div>
            <p>Earn points for swaps (volume + count), campaigns, payouts and streaks. Higher
            ratings unlock better visibility on the gaming bounty board.</p>
          </div>
          <RatingPanel ledger={ledger} />
        </section>

        {!hasContracts ? (
          <div className={styles.warn}>
            GameShield contracts are not configured yet. Open Developer settings in the footer
            to deploy or paste the deployed Registry and Helper addresses.
          </div>
        ) : (
          <>
            {/* Create */}
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.kicker}>New campaign</span>
                  <h2 className={styles.sectionTitle}>Create a gaming bounty</h2>
                </div>
                <p>Set the public reward and exact closing time. Title, places and description are committed on-chain and retained locally in this MVP.</p>
              </div>
              <div className={styles.campaignForm}>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span>Campaign title</span>
                  <input className={styles.input} placeholder="Summer speedrun challenge" maxLength={80} value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>Reward</span>
                  <div className={styles.formRow}>
                    <input className={styles.input} inputMode="decimal" value={rewardStrk} onChange={(e) => setRewardStrk(e.target.value)} />
                    <select className={styles.input} value={campaignToken} onChange={(e) => setCampaignToken(e.target.value)}>
                      {REWARD_TOKENS.map((t) => (
                        <option key={t.address} value={t.address}>{t.symbol}</option>
                      ))}
                    </select>
                  </div>
                </label>
                <label className={styles.field}>
                  <span>Ends at · your local time</span>
                  <input className={styles.input} type="datetime-local" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>Number of places</span>
                  <input className={styles.input} type="number" min="1" max="10000" step="1" value={seats} onChange={(e) => setSeats(e.target.value)} />
                  <small>Informational in the currently deployed contract.</small>
                </label>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>Detailed description and rules</span>
                  <textarea className={`${styles.input} ${styles.textarea}`} placeholder="Describe eligibility, game mode, scoring, deliverables, winner selection and reward conditions…" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
                  <small>{description.length}/2000 · Stored locally; its integrity commitment is public on-chain.</small>
                </label>
                <div className={styles.formSubmit}>
                  <span>Deadline is recorded on-chain but is not automatically enforced by the deployed registry.</span>
                  <button className={styles.btnCta} onClick={handleCreate} disabled={!isConnected || !isMainnet}>Create campaign</button>
                </div>
              </div>
              {!isConnected ? (
                <div className={styles.hint}>Connect a wallet to create and manage campaigns.</div>
              ) : null}
              {resultCreate ? <ResultCard r={resultCreate} /> : null}
            </section>

            {/* List */}
            <section className={styles.section} id="campaigns">
              <h2 className={styles.sectionTitle}>
                Campaigns
                <span className={styles.refreshGroup}>
                  <button
                    className={styles.refresh}
                    onClick={refreshCampaigns}
                    disabled={loading}
                    title="Refresh campaign list from the chain"
                  >
                    {loading ? "…" : "↻"}
                  </button>
                  <button
                    className={styles.refresh}
                    onClick={hardRefresh}
                    title="Hard refresh — reload the app, bypassing the browser cache (use if campaign changes do not appear)"
                  >
                    ⟳
                  </button>
                </span>
              </h2>
              {error ? <div className={styles.warn}>{error}</div> : null}
              {!loading && !campaigns.length ? (
                <div className={styles.hint}>No campaigns yet. Create the first one above.</div>
              ) : null}
              {campaigns.map((c) => {
                const isOrganizer =
                  connectedAddress && validateAddr(connectedAddress) === c.organizer;
                const r = results[c.id];
                const metadata = campaignMetadata[c.id];
                const metadataVerified = (() => {
                  try {
                    return Boolean(metadata && num.toBigInt(metadata.commitment) === num.toBigInt(c.criteriaHash));
                  } catch {
                    return false;
                  }
                })();
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
                    <div className={styles.campaignIntro}>
                      <h3>{metadataVerified ? metadata.title : `Campaign #${c.id}`}</h3>
                      <p>{metadataVerified ? metadata.description : "Detailed metadata is not available in this browser. The on-chain campaign state remains authoritative."}</p>
                    </div>
                    <div className={styles.campaignBody}>
                      <div className={styles.campaignMeta}>
                        <span>Reward</span>
                        <b>{formatTokenAmount(c.rewardAmount, tokenByAddress(c.token).decimals)} {symbolFor(c.token)}</b>
                      </div>
                      <div className={styles.campaignMeta}>
                        <span>Deadline</span>
                        <b>{fmtDeadline(c.deadline)}</b>
                      </div>
                      <div className={styles.campaignMeta}>
                        <span>Places</span>
                        <b>{metadataVerified ? metadata.seats : "—"}</b>
                      </div>
                      <div className={styles.campaignMeta}>
                        <span>Metadata</span>
                        <b className={styles.mono}>{metadataVerified ? "verified" : shortHex(c.criteriaHash)}</b>
                      </div>
                    </div>
                    {isOrganizer && c.status === 0 && (
                      <div className={styles.campaignActions}>
                        <button
                          className={`${styles.btn} ${styles.btnSmall}`}
                          disabled={busy[c.id] !== undefined}
                          onClick={() => handleFund(c)}
                        >
                          {busy[c.id] === "fund" ? "…" : "Fund reward"}
                        </button>
                        <button
                          className={`${styles.btn} ${styles.btnSmall}`}
                          disabled={busy[c.id] !== undefined}
                          onClick={() => handleCancel(c)}
                        >
                          {busy[c.id] === "cancel" ? "…" : "Delete campaign"}
                        </button>
                      </div>
                    )}
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
        <span className={styles.footerDot}>·</span>
        <button className={styles.footerLink} onClick={() => setShowDev((v) => !v)}>
          {showDev ? "Hide developer settings" : "Developer settings"}
        </button>
      </footer>
    </div>
  );
}
