"use client";

import { useEffect, useState, useCallback } from "react";
import { hash, num, validateAndParseAddress, type WalletAccountV6 } from "starknet";
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
    if (!myWalletAccount || !isMainnet) {
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
  }, [myWalletAccount, isMainnet]);

  useEffect(() => {
    refreshShielded();
  }, [refreshShielded, myFrontendProviderIndex]);

  const handleShield = async (mode: "deposit" | "withdraw") => {
    if (!myWalletAccount || !connectedAddress) {
      setShieldResult(errorResult("Connect a wallet first."));
      return;
    }
    if (!isMainnet) {
      setShieldResult(errorResult("STRK20 actions are available on Mainnet only."));
      return;
    }
    let amount: bigint;
    try {
      amount = parseStrkAmount(shieldAmount);
    } catch (e: any) {
      setShieldResult(errorResult(e?.message ?? "Enter a valid STRK amount."));
      return;
    }
    setShielding(true);
    setShieldResult(null);
    try {
      const actions: WALLET_API.STRK20_ACTION[] =
        mode === "deposit"
          ? [{ type: "deposit", token: constants.addrSTRK, amount: num.toHex(amount) }]
          : [
              {
                type: "withdraw",
                token: constants.addrSTRK,
                amount: num.toHex(amount),
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
      await myWalletAccount.strk20PrepareInvoke(actions, true);
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
      rows: [{ label: label, value: "STRK" }, { label: "Transaction", value: shortHex(txH), hash: txH }],
    });
    try {
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const r = receiptToResult(txR, txH);
      // Attach privacy events of our helper for verification.
      const evs = parseHelperEvents(txR, helper);
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
      const methods = api?.methods ?? [];
      const declareOk = methods.includes("wallet_addDeclareTransaction");
      const deployOk = methods.includes("wallet_addDeployAccountTransaction");
      setDeployResult({
        status: "ok",
        title: `Wallet API: declare ${declareOk ? "SUPPORTED" : "NOT SUPPORTED"}`,
        rows: [
          { label: "wallet_addDeclareTransaction", value: declareOk ? "yes" : "no" },
          { label: "wallet_addInvokeTransaction", value: methods.includes("wallet_addInvokeTransaction") ? "yes" : "no" },
          { label: "wallet_addDeployAccountTransaction", value: deployOk ? "yes" : "no" },
          { label: "Specs", value: String(specs?.specs ?? JSON.stringify(specs ?? [])) },
        ],
        note: "If declare is NOT supported, the wallet cannot deploy contracts. Use Argent X extension or starkli instead, then paste the addresses.",
      });
    } catch (e: any) {
      setDeployResult(errorResult(e?.message ?? String(e)));
    }
  };

  const handleSaveManual = async () => {
    try {
      const reg = validateAndParseAddress(manualRegistry);
      const hel = validateAndParseAddress(manualHelper);
      const [registryClass, helperClass] = await Promise.all([
        provider.getClassHashAt(reg),
        provider.getClassHashAt(hel),
      ]);
      if (num.toBigInt(registryClass) !== num.toBigInt("0x0043f1247fc09a89c13d776d13e8b6c7814d93193b64c0615e10238392edf038")) {
        throw new Error("Registry address is not the deployed CampaignRegistry contract.");
      }
      if (num.toBigInt(helperClass) !== num.toBigInt("0x0725c73fdb163124aace8e665cdd1c0e4d0678e36e360d75b490d08906d62df0")) {
        throw new Error("Helper address is not the deployed PayoutHelper contract.");
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
      const metadataPayload = {
        version: 1 as const,
        title,
        seats: seatCount,
        description: details,
        deadline: deadline.toString(),
        reward: reward.toString(),
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
        calldata: [num.toHex(reward), num.toHex(deadline), criteriaHash],
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
          </div>
          {deployResult ? <ResultCard r={deployResult} /> : null}
          </section>
        </details>
        ) : null}

        {/* Shield / unshield */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Shielded STRK</h2>
          <div className={styles.hint}>
            Private balance in the pool: <b className={styles.mono}>{shielded} STRK</b> — shield
            STRK before submitting a helper action.
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
                  <div className={styles.inputUnit}><input className={styles.input} inputMode="decimal" value={rewardStrk} onChange={(e) => setRewardStrk(e.target.value)} /><b>STRK</b></div>
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
                        <b>{fmtStrk(c.rewardAmount)} STRK</b>
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
