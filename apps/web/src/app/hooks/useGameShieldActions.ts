"use client";

import { useCallback, useRef, useState } from "react";
import { CallData, Contract, num, shortString } from "starknet";
import type { STRK20_ACTION } from "@starknet-io/types-js";
import abiClass from "../../../../../contracts/target/dev/gameshield_GameShield.contract_class.json";
import { useStoreWallet } from "../components/Wallet/walletContext";
import type { ActionResult, Campaign } from "../types";
import { errorResult } from "../types";
import { symbolFor } from "../../utils/tokens";

const abi = (abiClass as { abi: unknown[] }).abi;
const ZERO = "0x0";
const toFelt = (value: string | number | bigint) => `0x${BigInt(value).toString(16)}`;
const toCanonicalFelt = (value: string) => {
  const stripped = value.replace(/^0x0+/, "0x");
  return stripped === "0x" ? ZERO : stripped;
};
const isInsufficientPrivateBalance = (error: unknown) => /INSUFFICIENT_PRIVATE_BALANCE|insufficient\s+(private\s+)?balance/i.test(typeof (error as any)?.message === "string" ? (error as any).message : String(error));

export function useGameShieldActions(address: string) {
  const account = useStoreWallet((state) => state.myWalletAccount);
  const setAuthStatus = useStoreWallet((state) => state.setAuthStatus);
  const wallet = account;
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, ActionResult>>({});
  const [createBusy, setCreateBusy] = useState(false);
  const [resultCreate, setResultCreate] = useState<ActionResult | null>(null);
  const fundingInFlight = useRef(new Set<number>());
  const result = (title: string, transactionHash: string): ActionResult => ({ status: "ok", title, rows: [{ label: "Transaction", value: transactionHash, hash: transactionHash }] });
  const run = useCallback(async (id: number, state: string, action: () => Promise<ActionResult>) => {
    setBusy((current) => ({ ...current, [id]: state }));
    try { const value = await action(); setResults((current) => ({ ...current, [id]: value })); }
    catch (error: any) { setResults((current) => ({ ...current, [id]: errorResult(error?.message ?? "Transaction failed.") })); }
    finally { setBusy((current) => { const next = { ...current }; delete next[id]; return next; }); }
  }, []);
  const contract = () => {
    if (!account) throw Error("Connect a wallet first.");
    return new Contract({ abi, address, providerOrAccount: account });
  };

  const createCampaign = useCallback(async (input: { title: string; rewardAmount: string; token: string; deadlineAt: string; description: string; assignmentGracePeriod: string; claimExpiryWindow: string }) => {
    setCreateBusy(true);
    try {
      if (!account) throw Error("Connect a wallet first.");
      const tx = await contract().create_campaign(input.token, input.rewardAmount, Math.floor(new Date(input.deadlineAt).getTime() / 1000), "0x0", shortString.encodeShortString(input.title.slice(0, 31)), input.assignmentGracePeriod ?? "0", input.claimExpiryWindow ?? "0");
      const receipt: any = await account.provider.waitForTransaction(tx.transaction_hash);
      const event = receipt.events?.find((entry: any) => entry.keys?.length > 1);
      const campaignId = event?.keys?.[1];
      if (!campaignId) throw Error("Campaign created, but its CampaignCreated event was not found.");
      const campaignIdValue = num.toBigInt(campaignId).toString();
      const warnings: string[] = [];
      try {
        const descriptionResponse = await fetch("/api/campaign/description", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign_id: campaignIdValue, description: input.description }) });
        const descriptionBody = await descriptionResponse.json();
        if (descriptionResponse.status === 401) setAuthStatus("error", descriptionBody.error ?? "Verified session required");
        if (!descriptionResponse.ok) warnings.push(`Description couldn't be saved: ${descriptionBody.error ?? "try again from My Campaigns."}`);
      } catch (error: any) {
        warnings.push(`Description couldn't be saved: ${error?.message ?? "try again from My Campaigns."}`);
      }
      setResultCreate({ ...result("Campaign created on-chain.", tx.transaction_hash), note: warnings.length ? `${warnings.join(" ")} The on-chain campaign is still valid.` : "Description stored securely." });
    } catch (error: any) { setResultCreate(errorResult(error?.message ?? "Failed to create campaign.")); }
    finally { setCreateBusy(false); }
  }, [account, address, setAuthStatus]);

  const fundCampaign = useCallback((campaign: Campaign) => run(campaign.id, "fund", async () => {
    if (!wallet) throw Error("A STRK20-capable wallet is required.");
    if (fundingInFlight.current.has(campaign.id)) throw Error("Funding is already in progress for this campaign.");
    fundingInFlight.current.add(campaign.id);
    const token = toCanonicalFelt(campaign.token);
    const contractAddress = toCanonicalFelt(address);
    const amount = toFelt(campaign.rewardAmount);
    const actions: STRK20_ACTION[] = [
      { type: "withdraw", token, amount, recipient: contractAddress },
      {
        type: "invoke",
        contract: contractAddress,
        calldata: [toFelt(campaign.id), token, amount],
      },
    ];
    let tx: { transaction_hash: string };
    try {
      console.debug("[GameShield] strk20InvokeTransaction call", { campaignId: campaign.id, count: 1 });
      tx = await wallet.strk20InvokeTransaction(actions);
    } catch (error) {
      if (isInsufficientPrivateBalance(error)) throw Error(`Your wallet doesn't have a shielded balance of ${symbolFor(campaign.token)}. Shield it in your wallet first, then fund this campaign.`);
      throw error;
    } finally {
      fundingInFlight.current.delete(campaign.id);
    }
    return result("Campaign funded", tx.transaction_hash);
  }), [run, wallet, address]);
  const assignWinners = useCallback((campaign: Campaign, splits: { amount: string; winner_address: string }[]) => run(campaign.id, "assign", async () => {
    if (!account) throw Error("Connect a wallet first.");
    const tx = await account.execute(splits.map((split) => ({ contractAddress: address, entrypoint: "add_winner", calldata: CallData.compile({ campaign_id: campaign.id, amount: split.amount, winner_address: split.winner_address }) })));
    await account.provider.waitForTransaction(tx.transaction_hash);
    return result("Winner slots assigned", tx.transaction_hash);
  }), [run, account, address]);
  const sweepUnallocated = useCallback((campaign: Campaign) => run(campaign.id, "sweep", async () => {
    const tx = await account!.execute({ contractAddress: address, entrypoint: "sweep_unallocated", calldata: [campaign.id.toString()] });
    return result("Unallocated funds swept", tx.transaction_hash);
  }), [run, account, address]);
  const sweepExpiredSlot = useCallback((campaign: Campaign, slot: number) => run(campaign.id, "sweep", async () => {
    const tx = await account!.execute({ contractAddress: address, entrypoint: "sweep_expired_slot", calldata: [campaign.id.toString(), slot.toString()] });
    return result("Expired slot swept", tx.transaction_hash);
  }), [run, account, address]);
  const claimWinner = useCallback((campaign: Campaign, slot: number) => run(campaign.id, "claim", async () => { const tx = await account!.execute({ contractAddress: address, entrypoint: "claim_winner", calldata: [campaign.id.toString(), slot.toString()] }); return result("Reward claimed", tx.transaction_hash); }), [run, account, address]);
  const claimRefund = useCallback((campaign: Campaign) => run(campaign.id, "refund", async () => { const tx = await account!.execute({ contractAddress: address, entrypoint: "claim_refund", calldata: [campaign.id.toString()] }); return result("Refund claimed", tx.transaction_hash); }), [run, account, address]);
  return { busy, results, createBusy, resultCreate, createCampaign, fundCampaign, assignWinners, sweepUnallocated, sweepExpiredSlot, claimWinner, claimRefund };
}
