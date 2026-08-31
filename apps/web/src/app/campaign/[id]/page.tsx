"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import styles from "../../uni.module.css";
import { useStoreWallet } from "../../components/Wallet/walletContext";
import { useCampaigns } from "../../hooks/useCampaigns";
import * as constants from "../../../utils/constants";
import { decodeFeltString, fmtDeadline } from "../../../utils/format";
import { formatTokenAmount, tokenByAddress } from "../../../utils/tokens";
import { validateAddr } from "../../../utils/campaigns";
import { deriveCampaignStatus } from "../../../utils/campaignStatus";

export default function PublicCampaignPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const address = useStoreWallet((state) => state.address);
  const connected = useStoreWallet((state) => state.isConnected);
  const { campaigns, loading, error, refresh } = useCampaigns(constants.GameShieldAddress);
  const [participantCount, setParticipantCount] = useState<number | null>(null);
  const [alreadyParticipating, setAlreadyParticipating] = useState(false);
  const [applyState, setApplyState] = useState<"idle" | "saving" | "applied" | "error">("idle");
  const [applyError, setApplyError] = useState("");
  const campaign = useMemo(() => campaigns.find((candidate) => candidate.id === id), [campaigns, id]);
  const isOrganizer = Boolean(campaign && address && validateAddr(address) === validateAddr(campaign.organizer));

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!campaign) return;
    let cancelled = false;
    const query = new URLSearchParams({ campaign_id: String(campaign.id) });
    if (address) query.set("applicant_address", address);
    setAlreadyParticipating(false);
    setApplyState("idle");
    fetch(`/api/campaign/participants?${query.toString()}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not load participant count."); if (!cancelled) { setParticipantCount(body.count); setAlreadyParticipating(Boolean(body.applied)); if (body.applied) setApplyState("applied"); } })
      .catch(() => { if (!cancelled) setParticipantCount(null); });
    return () => { cancelled = true; };
  }, [address, campaign]);

  const apply = async () => {
    if (!address || isOrganizer) return;
    setApplyState("saving"); setApplyError("");
    try {
      const response = await fetch("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign_id: id, applicant_address: address }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not submit application.");
      setApplyState("applied");
      setParticipantCount((count) => count === null ? count : count + 1);
    } catch (failure: any) { setApplyState("error"); setApplyError(failure?.message ?? "Could not submit application."); }
  };

  if (loading && !campaign) return <main className={styles.main} style={{ paddingTop: 130 }}><section className={styles.section}><p className={styles.hint}>Loading campaign…</p></section></main>;
  if (error || !campaign) return <main className={styles.main} style={{ paddingTop: 130 }}><section className={styles.section}><h1 className={styles.sectionTitle}>Campaign #{id}</h1><p className={styles.warn}>{error || "Campaign not found."}</p></section></main>;

  const token = tokenByAddress(campaign.token);
  const title = decodeFeltString(campaign.title) || `Campaign #${campaign.id}`;
  const winningSlot = campaign.winnerSlots.find((slot) => address && !slot.claimed && validateAddr(slot.winnerAddress) === validateAddr(address));
  const claimedWinningSlot = campaign.winnerSlots.find((slot) => address && slot.claimed && validateAddr(slot.winnerAddress) === validateAddr(address));
  return <main className={styles.main} style={{ paddingTop: 130 }}>
    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><span className={styles.kicker}>Campaign #{campaign.id}</span><h1 className={styles.sectionTitle}>{title}</h1></div><span className={`${styles.statusPill} ${campaign.funded ? styles.statusActive : styles.statusCancel}`}>{campaign.funded ? "Reward funded" : "Not funded yet"}</span></div>
      <div className={styles.campaignBody}>
        <div className={styles.campaignMeta}><span>Reward pot</span><b>{formatTokenAmount(campaign.rewardAmount, token.decimals)} {token.symbol}</b></div>
        <div className={styles.campaignMeta}><span>Deadline</span><b>{fmtDeadline(campaign.deadline)}</b></div>
        <div className={styles.campaignMeta}><span>Participants</span><b>{participantCount === null ? "—" : `${participantCount} participant${participantCount === 1 ? "" : "s"}`}</b></div>
      </div>
      {!campaign.funded ? <p className={styles.hint}>The organizer still needs to fund this reward before it can be claimed.</p> : null}
      <h2 className={styles.sectionTitle}>Description</h2>
      <p>{campaign.description || "No public description provided."}</p>
      <div className={styles.campaignActions}>
        {!connected ? <span className={styles.hint}>Connect a wallet to participate.</span> : isOrganizer ? <span className={styles.hint}>You can&apos;t participate in this bounty — you created it.</span> : claimedWinningSlot ? <span className={styles.hint}>Participated and won. Rewards claimed.</span> : winningSlot ? <span className={styles.hint}>You won! Your reward is ready in My Campaigns.</span> : applyState === "applied" || alreadyParticipating ? <span className={styles.hint}>{deriveCampaignStatus(campaign) === "Closed" ? "Participated." : "Already participating in this bounty."}</span> : <button className={`${styles.btn} ${styles.btnGreen}`} onClick={() => void apply()} disabled={applyState === "saving" || !campaign.funded}>{applyState === "saving" ? "Applying…" : campaign.funded ? "Apply / Participate" : "Awaiting funding"}</button>}
        {applyState === "error" ? <span className={styles.winnerErr}>{applyError}</span> : null}
      </div>
    </section>
  </main>;
}
