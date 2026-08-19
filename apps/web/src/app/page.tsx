"use client";

import { useEffect, useState, useCallback } from "react";
import { hash, num, validateAndParseAddress, walletV6, compareVersions } from "starknet";
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
  registryContract,
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
import CampaignRegistrySierra from "../contracts/CampaignRegistry.sierra.json";
import CampaignRegistryCasm from "../contracts/CampaignRegistry.casm.json";
import PayoutHelperSierra from "../contracts/PayoutHelper.sierra.json";
import PayoutHelperCasm from "../contracts/PayoutHelper.casm.json";
import { tokenIcon } from "./components/TokenIcons";

// ─── formatting helpers ──────────────────────────────────────────────────────

function fmtStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
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
  // NOTE: title is also stored on-chain in the registry (felt252). The on-chain
  // title is the source of truth for cross-browser discoverability; the
  // localStorage copy carries the full multi-byte string for this browser only.
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
  const walletObj = useStoreWallet((s) => s.StarknetWalletObject);
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const strk20Supported = useStoreWallet((s) => s.strk20Supported);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);

  const networkName = constants.Strk20Networks[myFrontendProviderIndex];
  const isMainnet = myFrontendProviderIndex === 0;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [contractOutdated, setContractOutdated] = useState(false);

  // create form
  const [campaignTitle, setCampaignTitle] = useState("");
  const [rewardStrk, setRewardStrk] = useState("10");
  const [campaignToken, setCampaignToken] = useState(REWARD_TOKENS[0].address);
  const [deadlineAt, setDeadlineAt] = useState(defaultDeadline);
  const [seats, setSeats] = useState("32");
  const [description, setDescription] = useState("");
  const [campaignMetadata, setCampaignMetadata] = useState<Record<number, CampaignMetadata>>({});
  const [resultCreate, setResultCreate] = useState<ActionResult | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  // per-campaign results
  const [results, setResults] = useState<Record<number, ActionResult>>({});
  const [busy, setBusy] = useState<Record<number, string>>({});

  // shielded balance
  const [shielded, setShielded] = useState("");
  const [shieldAmount, setShieldAmount] = useState("10");
  const [shieldToken, setShieldToken] = useState(REWARD_TOKENS[0].address);
  const [shieldResult, setShieldResult] = useState<ActionResult | null>(null);
  const [shielding, setShielding] = useState(false);

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
      const message = e?.message ?? String(e);
      setError(
        message.includes("Cannot convert undefined to a BigInt")
          ? "Old GameShield contract detected at this address (no on-chain title field). The dapp requires GameShield v5. Open Developer settings below and click Deploy contracts to redeploy the current version."
          : message
      );
    } finally {
      setLoading(false);
    }
  }, [provider, registry, hasContracts]);

  useEffect(() => {
    refreshCampaigns();
  }, [refreshCampaigns, myFrontendProviderIndex]);

  // Detect outdated deployed contracts (v1/v2/v3/v4 without on-chain title) and
  // surface a prominent "Redeploy v5" CTA.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasContracts || !isMainnet) {
        setContractOutdated(false);
        return;
      }
      try {
        const c = registryContract(provider, registry);
        await c.get_campaign_count();
        const sample: any = await c.get_campaign(1).catch(() => null);
        if (cancelled) return;
        // v1/v2/v3/v4 do not include a `title` field on Campaign; v5 does.
        const hasTitle = sample && Object.prototype.hasOwnProperty.call(sample, "title");
        setContractOutdated(hasTitle === false);
      } catch {
        if (!cancelled) setContractOutdated(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, registry, hasContracts, isMainnet]);
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
    if (!isMainnet) return;
    refreshShielded();
  }, [refreshShielded, shieldToken]);

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
    tokenSymbol?: string,
    settlementAdvisory?: string
  ): Promise<string | undefined> {
    if (!myWalletAccount) {
      setResult(id, errorResult("No WalletAccount available."));
      return undefined;
    }
    if (!isMainnet) {
      setResult(id, errorResult("STRK20 actions are available on Mainnet only."));
      return undefined;
    }
    const advisoryRow: ResultRow[] = settlementAdvisory
      ? [{ label: "On-chain settlement", value: settlementAdvisory }]
      : [];
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
      rows: [
        { label: label, value: tokenSymbol ?? "STRK" },
        ...advisoryRow,
        { label: "Transaction", value: shortHex(txH), hash: txH },
      ],
    });
    try {
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const r = receiptToResult(txR, txH);
      if (advisoryRow.length) r.rows = [...(r.rows ?? []), ...advisoryRow];
      r.note = "Private STRK20 action confirmed. The reward moves through the pool — no public link between campaign and winner.";
      setResult(id, r);
    } catch (e: any) {
      setResult(id, {
        status: "error",
        title: "Could not confirm transaction",
        rows: [{ label: "Transaction", value: shortHex(txH), hash: txH }, ...advisoryRow],
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
    if (!walletObj) {
      setDeployResult(errorResult("Wallet standard object unavailable — reconnect the wallet."));
      return;
    }
    const STRK20_MIN = "0.10.3";
    const safeProbe = async (fn: () => Promise<unknown>, label: string) => {
      try {
        return { label, ok: true, value: await fn() };
      } catch (e: any) {
        const msg = e?.message ?? e?.toString?.() ?? String(e);
        return { label, ok: false, value: msg };
      }
    };
    try {
      const apiProbe = await safeProbe(
        () => walletV6.supportedWalletApi(walletObj),
        "supportedWalletApi"
      );
      const specsProbe = await safeProbe(
        () => walletV6.supportedSpecs(walletObj),
        "supportedSpecs"
      );
      const apiVersions: string[] = Array.isArray(apiProbe.value)
        ? (apiProbe.value as string[]).map(String)
        : [];
      const specs: string[] = Array.isArray(specsProbe.value)
        ? (specsProbe.value as string[]).map(String)
        : [];
      const hasStrk20 = apiVersions.some((v) => {
        try {
          return compareVersions(v, STRK20_MIN) >= 0;
        } catch {
          return false;
        }
      });
      const hasStarknetWalletApi = !!walletObj.features?.["starknet:walletApi"];
      const walletApiVersion =
        walletObj.features?.["starknet:walletApi"]?.version ?? "";
      const rows: ResultRow[] = [
        { label: "starknet:walletApi feature", value: hasStarknetWalletApi ? "yes" : "no" },
        { label: "starknet:walletApi version", value: String(walletApiVersion || "—") },
        {
          label: "supportedWalletApi()",
          value: apiProbe.ok
            ? apiVersions.length
              ? apiVersions.join(", ")
              : "(empty)"
            : `THREW: ${apiProbe.value}`,
        },
        {
          label: "supportedSpecs()",
          value: specsProbe.ok
            ? specs.length
              ? specs.join(", ")
              : "(empty)"
            : `THREW: ${specsProbe.value}`,
        },
        {
          label: "STRK20 support (api >= 0.10.3)",
          value: hasStrk20 ? "yes" : "no",
        },
        {
          label: "STRK20 via probe",
          value: hasStrk20
            ? "Wallet advertises an API version >= 0.10.3 — private actions should work."
            : "Wallet does NOT advertise an API version >= 0.10.3 — private actions (Fund/Payout) will be rejected.",
        },
      ];
      setDeployResult({
        status: "ok",
        title: hasStrk20
          ? "Wallet API: STRK20 SUPPORTED"
          : "Wallet API: STRK20 NOT SUPPORTED",
        rows,
        note: hasStrk20
          ? `STRK20 Wallet API ready. Advertised versions: ${apiVersions.join(", ") || "(none)"}.`
          : `Wallet advertises API versions: ${apiVersions.join(", ") || "(none)"}. ${STRK20_MIN} is required for STRK20 actions.`,
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
      note: "Approve each popup, or reject; the probe records the wallet's response either way. Each variant is tried against STRK, USDC, and ETH in turn.",
    });
    const rows: ResultRow[] = [];
    // Three representative tokens: STRK (18 dec, the canonical), USDC (6 dec),
    // ETH (18 dec, second-largest pool).
    const probeTokens = [
      REWARD_TOKENS.find((t) => t.symbol === "STRK") ?? REWARD_TOKENS[0],
      REWARD_TOKENS.find((t) => t.symbol === "USDC") ?? REWARD_TOKENS[2],
      REWARD_TOKENS.find((t) => t.symbol === "ETH") ?? REWARD_TOKENS[1],
    ];
    const variants: { build: (token: string) => WALLET_API.STRK20_ACTION[]; label: string }[] = [
      {
        label: "deposit 1 wei",
        build: (token) => [{ type: "deposit", token, amount: num.toHex(1n) }],
      },
      {
        label: "transfer 1 wei (no OPEN)",
        build: (token) => [
          { type: "transfer", token, amount: num.toHex(1n), recipient: connectedAddress },
        ],
      },
      {
        label: "withdraw 1 wei to self",
        build: (token) => [
          { type: "withdraw", token, amount: num.toHex(1n), recipient: connectedAddress },
        ],
      },
      {
        label: "transfer OPEN",
        build: (token) => [
          { type: "transfer", token, amount: "OPEN", recipient: connectedAddress },
        ],
      },
      {
        label: "withdraw + transfer OPEN",
        build: (token) => [
          { type: "withdraw", token, amount: num.toHex(1n), recipient: helper },
          { type: "transfer", token, amount: "OPEN", recipient: connectedAddress },
        ],
      },
      {
        label: "invoke helper (no OPEN)",
        build: (token) => [
          {
            type: "invoke",
            contract: helper,
            calldata: ["0x0", num.toHex(1), token, num.toHex(1n), "0x0", "0x1"],
          },
        ],
      },
    ];
    for (const variant of variants) {
      for (const token of probeTokens) {
        const tokenLabel = token?.symbol ?? token?.address ?? "unknown";
        const actions = variant.build(token.address);
        const r = await probeVariant(actions, `${variant.label} · ${tokenLabel}`);
        rows.push({ label: r.label, value: r.value, ok: r.ok });
      }
    }
    setDeployResult({
      status: "ok",
      title: "Probe results",
      rows,
      note: "Each variant is run against STRK, USDC, and ETH. If deposit/transfer-with-amount are accepted but OPEN variants are rejected, the wallet does not implement the OPEN literal yet. Per-token regressions (e.g. USDC fails where STRK succeeds) tell you which tokens the wallet's shielded state covers.",
    });
  };

  const handleSaveManual = async () => {
    try {
      const reg = validateAndParseAddress(manualRegistry);
      const hel = validateAndParseAddress(manualHelper);
      const [registryClassObj, helperClassObj] = await Promise.all([
        provider.getClass(reg),
        provider.getClass(hel),
      ]);
      const abiHas = (abi: any, entrypoint: string): boolean => {
        if (!Array.isArray(abi)) return false;
        return abi.some(
          (item: any) =>
            item &&
            typeof item === "object" &&
            (item.name === entrypoint || (item.type === "function" && item.name === entrypoint))
        );
      };
      const registryOk = abiHas(registryClassObj?.abi, "get_campaign_count");
      const helperOk = abiHas(helperClassObj?.abi, "privacy_invoke");
      // Fallback: if ABI could not be fetched, accept only current v3 class hashes plus
      // the most recently deployed class hashes saved by handleDeploy.
      let registryAccepted = registryOk;
      let helperAccepted = helperOk;
      if (!registryOk || !helperOk) {
        const [registryClassHash, helperClassHash] = await Promise.all([
          provider.getClassHashAt(reg),
          provider.getClassHashAt(hel),
        ]);
        const knownRegistry = [
          "0x7efa4207e9856f6483477e16abd4356c8f41dd20d937e223d2b62633e4f7585",
          "0xbf90178de204c169bff30ff7ed6092c4f084827a20a5a2864fc1dde4c08a13",
        ];
        const knownHelper = [
          "0xb05e4056756329c29a6259ee650ea5f7a6a61a8ddc3f6f7a9701b4edc7e63",
        ];
        let lastDeployed: any = {};
        try {
          const raw = localStorage.getItem("gameshield.lastDeployed");
          if (raw) lastDeployed = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        const acceptedRegistryHashes = [
          ...knownRegistry,
          ...(lastDeployed?.registryClassHash ? [String(lastDeployed.registryClassHash)] : []),
        ];
        const acceptedHelperHashes = [
          ...knownHelper,
          ...(lastDeployed?.helperClassHash ? [String(lastDeployed.helperClassHash)] : []),
        ];
        if (!registryAccepted) {
          registryAccepted = acceptedRegistryHashes.some(
            (h) => num.toBigInt(registryClassHash) === num.toBigInt(h)
          );
        }
        if (!helperAccepted) {
          helperAccepted = acceptedHelperHashes.some(
            (h) => num.toBigInt(helperClassHash) === num.toBigInt(h)
          );
        }
      }
      if (!registryAccepted) {
        throw new Error(
          "Registry address is not a deployed CampaignRegistry contract (ABI missing get_campaign_count, and class hash does not match a known version)."
        );
      }
      if (!helperAccepted) {
        throw new Error(
          "Helper address is not a deployed PayoutHelper contract (ABI missing privacy_invoke, and class hash does not match a known version)."
        );
      }
      saveDeployed({ registry: reg, helper: hel });
      setDeployResult({
        status: "ok",
        title: "Addresses saved",
        rows: [
          { label: "Registry", value: reg },
          { label: "Helper", value: hel },
        ],
        note: registryOk && helperOk
          ? "Verified via ABI: the registry exposes get_campaign_count and the helper exposes privacy_invoke."
          : "Saved via class-hash fallback (ABI could not be fetched on this RPC).",
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

      // Use declareAndDeploy for both contracts: 2 wallet popups total
      // (declare + deploy combined). Ready X's fee-review is friendlier when
      // each popup represents a single on-chain tx instead of two.
      setDeployState("Declaring + deploying CampaignRegistry…");
      const r1: any = await (myWalletAccount as any).declareAndDeploy({
        contract: cleanClass(CampaignRegistrySierra),
        casm: CampaignRegistryCasm,
        constructorCalldata: [validateAddr(connectedAddress)],
      });
      const r1ClassHash = pickAddr(r1.class_hash);
      const r1Address = pickAddr(r1.contract_address);
      const r1TxHash = r1.transaction_hash ?? r1.declare_transaction_hash;
      if (r1TxHash) await wait(r1TxHash);
      await verifyDeclared(r1ClassHash, "CampaignRegistry");
      await verifyDeployed(r1Address, r1ClassHash, "CampaignRegistry");

      setDeployState("Declaring + deploying PayoutHelper…");
      const r2: any = await (myWalletAccount as any).declareAndDeploy({
        contract: cleanClass(PayoutHelperSierra),
        casm: PayoutHelperCasm,
        constructorCalldata: [constants.PoolAddress, r1Address],
      });
      const r2ClassHash = pickAddr(r2.class_hash);
      const r2Address = pickAddr(r2.contract_address);
      const r2TxHash = r2.transaction_hash ?? r2.declare_transaction_hash;
      if (r2TxHash) await wait(r2TxHash);
      await verifyDeclared(r2ClassHash, "PayoutHelper");
      await verifyDeployed(r2Address, r2ClassHash, "PayoutHelper");

      const registryAddress = r1Address;
      const registryClassHash = r1ClassHash;
      const helperAddress = r2Address;
      const helperClassHash = r2ClassHash;

      setDeployState("Linking helper to registry…");
      const link = await myWalletAccount.execute([
        { contractAddress: registryAddress, entrypoint: "propose_helper", calldata: [helperAddress] },
      ] as any);
      await wait(link.transaction_hash);

      saveDeployed({ registry: registryAddress, helper: helperAddress });
      try {
        localStorage.setItem(
          "gameshield.lastDeployed",
          JSON.stringify({
            registryClassHash: registryClassHash,
            helperClassHash: helperClassHash,
            registryAddress,
            helperAddress,
            ts: Date.now(),
          })
        );
      } catch {
        /* localStorage unavailable — best-effort persistence for handleSaveManual. */
      }
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
      const raw = e?.message ?? e?.toString?.() ?? String(e);
      const m = raw.toLowerCase();
      const isUserRejection = m.includes("user rejected") || m.includes("user abort") || m.includes("user canceled") || m.includes("user cancelled") || m.includes("user denied");
      const isFeeReview = m.includes("max fee") || m.includes("fee too low") || m.includes("insufficient max fee") || m.includes("network fee") || m.includes("estimate_fee");
      const note = isUserRejection
        ? "Transaction was rejected in the wallet. Click Deploy contracts again to continue."
        : isFeeReview
          ? "Ready X fee-review for an unknown contract set a high max-fee. Click Deploy contracts again — the fee review usually settles on the second attempt."
          : undefined;
      setDeployResult({ status: "error", title: "Action failed", note, rows: [{ label: "Error", value: raw }] });
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
    setCreateBusy(true);
    try {
      let reward: bigint;
      let deadline: bigint;
      let seatCount: number;
      let criteriaHash: string;
      let metadata: CampaignMetadata;
      let title: string;
      try {
        title = campaignTitle.trim();
        const details = description.trim();
        if (title.length < 3 || title.length > 80) {
          throw new Error("Campaign title must be 3–80 characters.");
        }
        if (details.length < 20 || details.length > 2000) {
          throw new Error("Detailed description must be 20–2000 characters.");
        }
        reward = parseTokenAmount(rewardStrk, tokenByAddress(campaignToken).decimals);
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
          calldata: [
            num.toHex(reward),
            num.toHex(deadline),
            criteriaHash,
            campaignToken,
            hash.getSelectorFromName(title.trim()),
          ],
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
        const message = e?.message ?? String(e);
        const isOldContract =
          message.toLowerCase().includes("input too long") ||
          message.toLowerCase().includes("selector") ||
          message.toLowerCase().includes("input too short");
        setResultCreate(
          errorResult(
            isOldContract
              ? `The deployed CampaignRegistry (v1/v2 — 3 args) is incompatible with the current dapp (v5 — 5 args: reward, deadline, criteria, token, title). Click "Deploy contracts" in Developer settings below to redeploy the current v5 version.`
              : `Campaign contract simulation failed: ${message}`
          )
        );
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
      } catch (e: any) {
        setResultCreate(errorResult(e?.message ?? String(e)));
      }
    } finally {
      setCreateBusy(false);
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
  // NOTE (SEC-01): the live v2 flow performs a direct STRK20 `transfer` from the
  // organizer's shielded note to the winner and does NOT call the registry's
  // payout entrypoint. The registry's `paid` flag is therefore advisory
  // (informational) and may not reflect actual settlement. UI labels the action
  // "Send private reward" to make this clear.
  const PAYOUT_SETTLEMENT_ADVISORY =
    "advisory only — `paid` flag is not updated by this dapp; the registry's payout state is informational";
  const handlePayout = async (c: Campaign, winnerAddr: string) => {
    setBusyFor(c.id, "payout");
    try {
      const commitment = winnerCommitment(c.id, winnerAddr);
      const actions: WALLET_API.STRK20_ACTION[] = [
        { type: "transfer", token: c.token, amount: num.toHex(c.rewardAmount), recipient: validateAddr(winnerAddr) },
      ];
      await submitPrivate(actions, c.id, "Send private reward", symbolFor(c.token), PAYOUT_SETTLEMENT_ADVISORY);
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
          onChange={(e) => {
            setWinner(e.target.value);
            if (winnerErr) setWinnerErr("");
          }}
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
              disabled={busy[c.id] !== undefined || strk20Supported === false}
              onClick={() => submitWinner("payout")}
              title={strk20Supported === false ? "Wallet does not support STRK20" : undefined}
            >
              {busy[c.id] === "payout" ? "…" : "Send private reward"}
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
          <details className={styles.privacyDetails}>
            <summary>How does privacy work?</summary>
            <div className={styles.hint}>
              <p>GameShield uses the STRK20 privacy pool to shield STRK/ETH/USDC and other supported tokens — your wallet deposits into the pool and the pool issues shielded notes that only your wallet can later spend.</p>
              <p>Private balances in the pool are not linked to your main wallet address; the dapp never sees viewing keys, notes, or recipient private keys.</p>
              <p>Deposits are screened by FPI. Withdrawals and transfers settle through the pool and inherit STRK20&apos;s privacy guarantees against recipient linkage.</p>
              <p>Note: the campaign registry records amount, token and timing on-chain. Only the winner address is hidden — treats the campaign as a public commitment that the organizer is expected to honour.</p>
            </div>
          </details>
        </section>

        {/* Deploy / configure contracts — hidden in Developer settings */}
        {showDev ? (
        <details id="developer-settings" className={styles.advancedPanel} open>
          <summary>Developer settings</summary>
          <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Contract configuration</h2>
          <div className={styles.hint}>
            One-time setup on Mainnet (the STRK20 pool lives there). Deploy with your wallet
            or paste already-deployed addresses.
          </div>
          <div className={styles.hint}>
            GameShield contracts are at v5 (multi-token, on-chain title, deadline enforcement,
            two-step helper handover). If you deployed an older version, click Deploy contracts
            again to redeploy with the latest version.
          </div>
          <div className={styles.hint}>
            <b>Ready X fee-review note:</b> the first deploy triggers 3 wallet popups
            (declare registry, deploy registry, declare helper, deploy helper, link helper).
            Ready X may show a large network-fee margin on the first popup because the
            CampaignRegistry / PayoutHelper contracts are new to it. If the Confirm button
            looks stuck or shows a high fee, cancel the popup, click Deploy contracts again —
            the fee review usually settles on the second attempt.
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

          <div className={styles.starkliBox}>
            <div className={styles.hint}>
              <b>If Deploy contracts keeps showing a stuck Confirm button in Ready X:</b>{" "}
              bypass the wallet's fee-review entirely by deploying via the{" "}
              <a
                className={styles.warnLink}
                href="https://book.starkli.rs/installation"
                target="_blank"
                rel="noopener noreferrer"
              >
                starkli CLI
              </a>
              {" "}in your terminal. The repo ships an automated script:
            </div>
            <pre className={styles.starkliCode}>{`# from repo root
OWNER_ADDRESS=<your Starknet address> bash scripts/deploy-starkli.sh`}</pre>
            <div className={styles.hint}>
              The script writes <b className={styles.mono}>scripts/deploy-output.json</b>{" "}
              with the new Registry + Helper addresses. Paste them into the
              Save fields above and click Save.
            </div>
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
            <span className={styles.tokenPicker}>
              {(() => {
                const Icon = tokenIcon(symbolFor(shieldToken));
                return <Icon size={22} className={styles.tokenBadge} title={symbolFor(shieldToken)} />;
              })()}
              <select
                className={styles.input}
                value={shieldToken}
                onChange={(e) => setShieldToken(e.target.value)}
              >
                {REWARD_TOKENS.map((t) => (
                  <option key={t.address} value={t.address}>{t.symbol} — {t.name}</option>
                ))}
              </select>
            </span>
            <input
              className={styles.input}
              placeholder={`Amount (${symbolFor(shieldToken)})`}
              value={shieldAmount}
              onChange={(e) => setShieldAmount(e.target.value)}
            />
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
                disabled={!isConnected || !isMainnet || shielding || strk20Supported === false}
              onClick={() => handleShield("deposit")}
            >
              {shielding ? "…" : "Shield"}
            </button>
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
                disabled={!isConnected || !isMainnet || shielding || strk20Supported === false}
              onClick={() => handleShield("withdraw")}
            >
              {shielding ? "…" : "Unshield"}
            </button>
          </div>
          {!isConnected ? (
            <div className={styles.hint}>Connect a wallet to manage your shielded balance.</div>
          ) : null}
          {isConnected && strk20Supported === false ? (
            <div className={styles.strk20WarnBlock}>
              This wallet does not advertise STRK20 Wallet API support. Shield, Fund, and Payout are disabled — Connect a STRK20-capable wallet (Ready, Xverse) to use these features.
            </div>
          ) : null}
          {shieldResult ? <ResultCard r={shieldResult} /> : null}
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
                    <span className={styles.tokenPicker}>
                      {(() => {
                        const Icon = tokenIcon(symbolFor(campaignToken));
                        return <Icon size={22} className={styles.tokenBadge} title={symbolFor(campaignToken)} />;
                      })()}
                      <select className={styles.input} value={campaignToken} onChange={(e) => setCampaignToken(e.target.value)}>
                        {REWARD_TOKENS.map((t) => (
                          <option key={t.address} value={t.address}>{t.symbol}</option>
                        ))}
                      </select>
                    </span>
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
                  <button className={styles.btnCta} onClick={handleCreate} disabled={!isConnected || !isMainnet || createBusy}>{createBusy ? "Creating…" : "Create campaign"}</button>
                </div>
              </div>
              {!isConnected ? (
                <div className={styles.hint}>Connect a wallet to create and manage campaigns.</div>
              ) : null}
              {resultCreate ? <ResultCard r={resultCreate} /> : null}
              {contractOutdated && (
                <div className={styles.warn}>
                  <b>Outdated contracts detected.</b> The deployed CampaignRegistry is an older version
                  (no on-chain title). The dapp requires GameShield v5.{" "}
                  <a href="#developer-settings" className={styles.warnLink}>Open Developer settings</a>{" "}
                  and click <b>Deploy contracts</b> to redeploy.
                </div>
              )}
            </section>

            {/* List */}
            <section className={styles.section} id="campaigns">
              <h2 className={styles.sectionTitle}>
                Campaigns
                <span className={styles.refreshGroup}>
                  <button
                    className={`${styles.refresh} ${loading ? styles.refreshSpin : ""}`}
                    onClick={refreshCampaigns}
                    disabled={loading}
                    title="Refresh campaign list from the chain"
                  >
                    ↻
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
              {error && !campaigns.length ? (
                <div className={styles.hint}>
                  Could not load campaigns: <b>{error}</b>. Check the connection and try the refresh button.
                </div>
              ) : null}
              {loading && !campaigns.length ? (
                <>
                  <div className={styles.skeletonCard} aria-hidden="true" />
                  <div className={styles.skeletonCard} aria-hidden="true" />
                  <div className={styles.skeletonCard} aria-hidden="true" />
                </>
              ) : null}
              {!loading && !error && !campaigns.length && isConnected && !hasContracts ? (
                <div className={styles.hint}>
                  GameShield contracts are not deployed yet.
                  <div className={styles.formRow}>
                    <button
                      className={styles.btnCta}
                      onClick={() => {
                        setShowDev(true);
                        setTimeout(() => {
                          document
                            .getElementById("developer-settings")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }, 50);
                      }}
                    >
                      Deploy contracts via Developer settings
                    </button>
                  </div>
                </div>
              ) : null}
              {!loading && !error && !campaigns.length && (hasContracts || !isConnected) ? (
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
                const onchainTitle = (() => {
                  try {
                    const hex = c.title;
                    if (!hex || hex === "0x0") return null;
                    const trimmed = hex.startsWith("0x") ? hex.slice(2) : hex;
                    let s = "";
                    for (let i = 0; i < trimmed.length; i += 2) {
                      const code = parseInt(trimmed.slice(i, i + 2), 16);
                      if (code === 0) break;
                      s += String.fromCharCode(code);
                    }
                    return s || null;
                  } catch {
                    return null;
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
                      {c.status === 1 && !c.paid ? (
                        <span className={styles.campaignOrg} title="The live v2 flow does not call the registry's payout entrypoint; the `paid` flag is therefore advisory and may not reflect actual settlement.">
                          (advisory — registry `paid` is not set by the live flow)
                        </span>
                      ) : null}
                      <span className={styles.campaignOrg}>by {shortHex(c.organizer)}</span>
                    </div>
                    <div className={styles.campaignIntro}>
                      <h3>
                        {onchainTitle || (metadataVerified ? metadata.title : `Campaign #${c.id}`)}
                        {onchainTitle ? (
                          <span className={styles.eyebrow} style={{ marginLeft: 8 }}>on-chain</span>
                        ) : null}
                      </h3>
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
                          disabled={busy[c.id] !== undefined || strk20Supported === false}
                          onClick={() => handleFund(c)}
                          title={strk20Supported === false ? "Wallet does not support STRK20" : undefined}
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
