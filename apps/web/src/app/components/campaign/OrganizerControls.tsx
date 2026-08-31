"use client";

import { useEffect, useState } from "react";
import { validateAndParseAddress } from "starknet";
import styles from "../../uni.module.css";
import type { Campaign } from "../../types";
import { parseTokenAmount, symbolFor, tokenByAddress } from "../../../utils/tokens";
import { useStoreWallet } from "../Wallet/walletContext";

export default function OrganizerControls({
  campaign,
  strk20Supported,
  busy,
  onFund,
  onAssignWinners,
  onSweepUnallocated,
}: {
  campaign: Campaign;
  strk20Supported: boolean | undefined;
  busy: string | undefined;
  onFund: (c: Campaign) => void;
  onAssignWinners: (c: Campaign, splits: { amount: string; winner_address: string }[]) => Promise<void>;
  onSweepUnallocated: (c: Campaign) => void;
}) {
  const wallet = useStoreWallet((state) => state.myWalletAccount);
  const [winners, setWinners] = useState([{ address: "", amount: "" }]);
  const [winnerErr, setWinnerErr] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [applicants, setApplicants] = useState<{ applicant_address: string }[]>([]);
  const [applicantError, setApplicantError] = useState("");
  const [fundingBalance, setFundingBalance] = useState<"checking" | "sufficient" | "insufficient" | "unavailable">("checking");

  useEffect(() => {
    if (campaign.funded) return;
    if (!wallet || strk20Supported === false) { setFundingBalance("unavailable"); return; }
    let cancelled = false;
    setFundingBalance("checking");
    wallet.strk20Balances([campaign.token])
      .then((balances) => {
        const balance = balances.find((entry) => BigInt(entry.token) === BigInt(campaign.token))?.balance ?? "0";
        if (!cancelled) setFundingBalance(BigInt(balance) >= campaign.rewardAmount ? "sufficient" : "insufficient");
      })
      .catch(() => { if (!cancelled) setFundingBalance("unavailable"); });
    return () => { cancelled = true; };
  }, [campaign.funded, campaign.rewardAmount, campaign.token, strk20Supported, wallet]);

  useEffect(() => {
    if (!campaign.funded || campaign.status !== "active") return;
    let cancelled = false;
    fetch(`/api/organizer/applicants?campaign_id=${campaign.id}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load applicants.");
        if (!cancelled) setApplicants(body);
      })
      .catch((error: any) => { if (!cancelled) setApplicantError(error?.message ?? "Could not load applicants."); });
    return () => { cancelled = true; };
  }, [campaign.funded, campaign.id, campaign.status]);

  if (campaign.status !== "active") return null;

  const submitWinners = async () => {
    try {
      if (!winners.length) throw new Error("Add at least one winner.");
      const splits = winners.map(({ address, amount }) => {
        if (!address) throw new Error("Select an applicant for every winner slot.");
        return { winner_address: validateAndParseAddress(address), amount: parseTokenAmount(amount, tokenByAddress(campaign.token).decimals).toString() };
      });
      setWinnerErr("");
      setAssigning(true);
      const response = await fetch("/api/organizer/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id, splits }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not prepare winner slots.");
      await onAssignWinners(campaign, body.map((slot: { amount: string; winner_address: string }) => ({
        amount: slot.amount,
        winner_address: slot.winner_address,
      })));
    } catch (e: any) {
      setWinnerErr(
        e?.message && !String(e?.message).includes("Invalid Starknet address")
          ? String(e.message)
          : "Enter a valid Starknet wallet address (0x…).",
      );
    } finally { setAssigning(false); }
  };

  return (
    <div className={styles.campaignActions}>
      {!campaign.funded ? (
        <>
          <button
            className={`${styles.btn} ${styles.btnSmall}`}
            disabled={busy !== undefined || strk20Supported === false || fundingBalance !== "sufficient"}
            onClick={() => onFund(campaign)}
            title={strk20Supported === false ? "This wallet does not support private STRK20 funding on this network." : fundingBalance === "checking" ? "Checking shielded balance…" : undefined}
          >
            {busy === "fund" ? "…" : "Fund reward"}
          </button>
          {strk20Supported === false ? <span className={styles.hint}>Your wallet doesn&apos;t support private funding on this network yet.</span> : null}
          {fundingBalance === "checking" ? <span className={styles.hint}>Checking your shielded {symbolFor(campaign.token)} balance…</span> : null}
          {fundingBalance === "insufficient" ? <span className={styles.hint}>Your wallet doesn&apos;t have a shielded balance of {symbolFor(campaign.token)}. Shield it in your wallet first, then fund this campaign.</span> : null}
          {fundingBalance === "unavailable" && strk20Supported !== false ? <span className={styles.hint}>We couldn&apos;t check your shielded balance. Approve the wallet balance request, then try again.</span> : null}
        </>
      ) : null}
      {campaign.funded ? (
        <div className={styles.winnerRow}>
          {!applicants.length && !applicantError ? <span className={styles.hint}>No applicants yet. Participants can apply from the campaign detail page.</span> : null}
          {applicantError ? <span className={styles.winnerErr}>{applicantError}</span> : null}
          {winners.map((winner, index) => (
            <div className={styles.winnerRow} key={index}>
              <select
                className={styles.input}
                value={winner.address}
                onChange={(e) => setWinners((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, address: e.target.value } : entry))}
                disabled={busy !== undefined || assigning}
              >
                <option value="">Select applicant {index + 1}</option>
                {applicants.map((applicant) => <option key={applicant.applicant_address} value={applicant.applicant_address}>{applicant.applicant_address}</option>)}
              </select>
              <input
                className={styles.input}
                placeholder={`Amount (${symbolFor(campaign.token)})`}
                value={winner.amount}
                onChange={(e) => setWinners((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount: e.target.value } : entry))}
                disabled={busy !== undefined || assigning}
              />
              {winners.length > 1 ? <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => setWinners((current) => current.filter((_, entryIndex) => entryIndex !== index))} disabled={busy !== undefined || assigning}>Remove</button> : null}
            </div>
          ))}
          <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => setWinners((current) => [...current, { address: "", amount: "" }])} disabled={busy !== undefined || assigning}>Add winner</button>
          <div className={styles.winnerBtns}>
            <button
              className={`${styles.btn} ${styles.btnSmall}`}
                onClick={() => void submitWinners()}
              disabled={busy !== undefined || assigning}
            >
              {busy === "assign" || assigning ? "…" : "Assign winner slots"}
            </button>
          </div>
          {winnerErr ? <span className={styles.winnerErr}>{winnerErr}</span> : null}
        </div>
      ) : null}
      {campaign.funded ? <button
        className={`${styles.btn} ${styles.btnSmall}`}
        disabled={busy !== undefined}
        onClick={() => onSweepUnallocated(campaign)}
      >
        {busy === "sweep" ? "…" : "Sweep unallocated funds"}
      </button> : null}
    </div>
  );
}
