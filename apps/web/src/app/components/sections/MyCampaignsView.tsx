"use client";

import type { ActionResult, Campaign, WinnerSlot } from "../../types";
import styles from "../../uni.module.css";
import { fmtDeadline, formatDuration, decodeFeltString } from "../../../utils/format";
import { formatTokenAmount, symbolFor, tokenByAddress } from "../../../utils/tokens";
import { deriveCampaignStatus } from "../../../utils/campaignStatus";
import { useRouter } from "next/navigation";

export type ParticipantCampaign = {
  campaign: Campaign;
  applied: boolean;
  winnerSlots: { slot: WinnerSlot }[];
  claimedSlots: WinnerSlot[];
};

function WindowWarning({ campaign }: { campaign: Campaign }) {
  if (campaign.assignmentGracePeriod !== 0n && campaign.claimExpiryWindow !== 0n) return null;
  return <div className={styles.hint} role="alert">⚠️ Warning: this campaign has a 0-second {campaign.assignmentGracePeriod === 0n && campaign.claimExpiryWindow === 0n ? "assignment grace and claim-expiry window" : campaign.assignmentGracePeriod === 0n ? "assignment grace period" : "claim-expiry window"}.</div>;
}

function CampaignSummary({ campaign }: { campaign: Campaign }) {
  return <>
    <div className={styles.campaignHead}><span className={styles.campaignId}>#{campaign.id}</span><span className={`${styles.statusPill} ${campaign.funded ? styles.statusActive : styles.statusCancel}`}>{campaign.funded ? "Funded" : "Draft — awaiting funding"}</span></div>
    <h3>{decodeFeltString(campaign.title) || `Campaign #${campaign.id}`}</h3>
    <div className={styles.campaignBody}>
      <div className={styles.campaignMeta}><span>Reward</span><b>{formatTokenAmount(campaign.rewardAmount, tokenByAddress(campaign.token).decimals)} {symbolFor(campaign.token)}</b></div>
      <div className={styles.campaignMeta}><span>Deadline</span><b>{fmtDeadline(campaign.deadline)}</b></div>
      <div className={styles.campaignMeta}><span>Winner slots</span><b>{campaign.winnerSlotCount ? campaign.winnerSlotCount : "No winners assigned yet"}</b></div>
      <div className={styles.campaignMeta}><span>Grace / expiry</span><b>{formatDuration(campaign.assignmentGracePeriod)} / {formatDuration(campaign.claimExpiryWindow)}</b></div>
    </div>
    <WindowWarning campaign={campaign} />
  </>;
}

export default function MyCampaignsView({ organizers, participants, busy, results, now, onReclaim, onSweepSlot, onClaimWinner, onClaimRefund }: {
  organizers: Campaign[];
  participants: ParticipantCampaign[];
  busy: Record<number, string>;
  results: Record<number, ActionResult>;
  now: bigint;
  onReclaim: (campaign: Campaign) => void;
  onSweepSlot: (campaign: Campaign, slot: number) => void;
  onClaimWinner: (campaign: Campaign, slot: number) => void;
  onClaimRefund: (campaign: Campaign) => void;
}) {
  const router = useRouter();
  const organizerActive = organizers.filter((campaign) => deriveCampaignStatus(campaign, now) !== "Closed");
  const organizerClosed = organizers.filter((campaign) => deriveCampaignStatus(campaign, now) === "Closed");
  const participantActive = participants.filter(({ campaign }) => deriveCampaignStatus(campaign, now) !== "Closed");
  const participantClosed = participants.filter(({ campaign }) => deriveCampaignStatus(campaign, now) === "Closed");
  const organizerCard = (campaign: Campaign) => {
    const canSweepCampaign = campaign.funded && !campaign.unallocatedSwept && now > campaign.deadline + campaign.assignmentGracePeriod && campaign.totalAllocated < campaign.rewardAmount;
    return <article className={styles.campaignCard} key={`organizer-${campaign.id}`} onClick={(event) => { if (!(event.target as HTMLElement).closest("button, input, select, textarea, a")) router.push(`/my-campaigns/${campaign.id}`); }} role="link" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/my-campaigns/${campaign.id}`); }}><CampaignSummary campaign={campaign} /><div className={styles.campaignActions}>
      {canSweepCampaign ? <button className={`${styles.btn} ${styles.btnSmall}`} disabled={busy[campaign.id] !== undefined} onClick={() => onReclaim(campaign)}>{busy[campaign.id] === "sweep" ? "…" : "Sweep unallocated funds"}</button> : null}
      {campaign.refundPool > 0n ? <button className={`${styles.btn} ${styles.btnSmall}`} disabled={busy[campaign.id] !== undefined} onClick={() => onClaimRefund(campaign)}>{busy[campaign.id] === "refund" ? "…" : "Claim refund"}</button> : null}
      {campaign.winnerSlots.map((slot) => {
        const canSweepSlot = campaign.funded && !slot.claimed && now > slot.assignedAt + campaign.claimExpiryWindow;
        return canSweepSlot ? <button key={slot.slotId} className={`${styles.btn} ${styles.btnSmall}`} disabled={busy[campaign.id] !== undefined} onClick={() => onSweepSlot(campaign, slot.slotId)}>{busy[campaign.id] === "sweep" ? "…" : `Sweep expired slot ${slot.slotId}`}</button> : null;
      })}
      {!canSweepCampaign && !campaign.winnerSlots.some((slot) => campaign.funded && !slot.claimed && now > slot.assignedAt + campaign.claimExpiryWindow) ? <span className={styles.hint}>No funds are currently eligible for a timeout sweep.</span> : null}
    </div>{results[campaign.id] ? <div className={styles.hint}>{results[campaign.id].title}</div> : null}</article>;
  };
  const participantCard = ({ campaign, applied, winnerSlots, claimedSlots }: ParticipantCampaign) => <article className={styles.campaignCard} key={`participant-${campaign.id}`} onClick={(event) => { if (!(event.target as HTMLElement).closest("button, input, select, textarea, a")) router.push(`/campaign/${campaign.id}`); }} role="link" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/campaign/${campaign.id}`); }}>
    <CampaignSummary campaign={campaign} />
    {claimedSlots.length ? <div className={styles.hint}>Participated and won. Rewards claimed.</div> : null}
    {winnerSlots.map(({ slot }) => <div className={styles.winnerRow} key={slot.slotId}><span className={styles.hint}>You won! Reward ready · {formatTokenAmount(slot.amount, tokenByAddress(campaign.token).decimals)} {symbolFor(campaign.token)}</span><button className={`${styles.btn} ${styles.btnGreen} ${styles.btnSmall}`} disabled={busy[campaign.id] !== undefined} onClick={() => onClaimWinner(campaign, slot.slotId)}>{busy[campaign.id] === "claim" ? "Claiming…" : "Claim reward"}</button></div>)}
    {applied && !winnerSlots.length && !claimedSlots.length ? <div className={styles.hint}>{deriveCampaignStatus(campaign, now) === "Closed" ? "Participated." : "Already participating in this bounty."}</div> : null}
    {results[campaign.id] ? <div className={styles.hint}>{results[campaign.id].title}</div> : null}
  </article>;
  return <>
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Organizer campaigns</h2>
      {!organizers.length ? <p className={styles.hint}>No campaigns created by this wallet.</p> : <><h3 className={styles.sectionTitle}>Active</h3>{organizerActive.length ? organizerActive.map(organizerCard) : <p className={styles.hint}>No active bounties right now.</p>}<h3 className={styles.sectionTitle}>Closed</h3>{organizerClosed.length ? organizerClosed.map(organizerCard) : <p className={styles.hint}>No closed bounties yet.</p>}</>}
    </section>
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Participant campaigns</h2>
      {!participants.length ? <p className={styles.hint}>No applications or winner slots found for this wallet.</p> : <><h3 className={styles.sectionTitle}>Active</h3>{participantActive.length ? participantActive.map(participantCard) : <p className={styles.hint}>No active bounties right now.</p>}<h3 className={styles.sectionTitle}>Closed</h3>{participantClosed.length ? participantClosed.map(participantCard) : <p className={styles.hint}>No closed bounties yet.</p>}</>}
    </section>
  </>;
}
