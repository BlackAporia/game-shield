"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { constants as SNconstants } from "starknet";
import styles from "../../uni.module.css";
import * as constants from "../../../utils/constants";
import { validateAddr } from "../../../utils/campaigns";
import { decodeFeltString, fmtDeadline, formatDuration, shortHex } from "../../../utils/format";
import { formatTokenAmount, tokenByAddress } from "../../../utils/tokens";
import { useStoreWallet } from "../../components/Wallet/walletContext";
import { useCampaigns } from "../../hooks/useCampaigns";
import { useGameShieldActions } from "../../hooks/useGameShieldActions";
import OrganizerControls from "../../components/campaign/OrganizerControls";
import ResultCard from "../../components/shared/ResultCard";

export default function CampaignManagementPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const router = useRouter();
  const address = useStoreWallet((state) => state.address);
  const strk20Supported = useStoreWallet((state) => state.strk20Supported);
  const chain = useStoreWallet((state) => state.chain);
  const { campaigns, loading, error, refresh } = useCampaigns(constants.GameShieldAddress);
  const { busy, results, fundCampaign, assignWinners, sweepUnallocated, sweepExpiredSlot } = useGameShieldActions(constants.GameShieldAddress);
  const [applicants, setApplicants] = useState<{ applicant_address: string }[]>([]);
  const [now, setNow] = useState(BigInt(Math.floor(Date.now() / 1000)));
  const campaign = useMemo(() => campaigns.find((candidate) => candidate.id === id), [campaigns, id]);
  const authorized = Boolean(campaign && address && validateAddr(address) === validateAddr(campaign.organizer));

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (campaign && !authorized) router.replace(`/campaign/${id}`); }, [authorized, campaign, id, router]);
  useEffect(() => { const timer = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!campaign || !authorized) return;
    let cancelled = false;
    fetch(`/api/organizer/applicants?campaign_id=${campaign.id}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not load applicants."); if (!cancelled) setApplicants(body); })
      .catch(() => { if (!cancelled) setApplicants([]); });
    return () => { cancelled = true; };
  }, [authorized, campaign]);

  if (loading && !campaign) return <main className={styles.main} style={{ paddingTop: 130 }}><section className={styles.section}><p className={styles.hint}>Loading campaign management…</p></section></main>;
  if (error || !campaign) return <main className={styles.main} style={{ paddingTop: 130 }}><section className={styles.section}><h1 className={styles.sectionTitle}>Campaign #{id}</h1><p className={styles.warn}>{error || "Campaign not found."}</p></section></main>;
  if (!authorized) return <main className={styles.main} style={{ paddingTop: 130 }}><section className={styles.section}><p className={styles.hint}>Opening the public campaign view…</p></section></main>;

  const token = tokenByAddress(campaign.token);
  const title = decodeFeltString(campaign.title) || `Campaign #${campaign.id}`;
  const isMainnet = chain === SNconstants.StarknetChainId.SN_MAIN;
  const result = results[campaign.id];
  return <main className={styles.main} style={{ paddingTop: 130 }}>
    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><span className={styles.kicker}>Organizer management · Campaign #{campaign.id}</span><h1 className={styles.sectionTitle}>{title}</h1></div><span className={`${styles.statusPill} ${campaign.funded ? styles.statusActive : styles.statusCancel}`}>{campaign.funded ? "Funded" : "Draft — awaiting funding"}</span></div>
      <div className={styles.campaignBody}>
        <div className={styles.campaignMeta}><span>Reward pot</span><b>{formatTokenAmount(campaign.rewardAmount, token.decimals)} {token.symbol}</b></div>
        <div className={styles.campaignMeta}><span>Deadline</span><b>{fmtDeadline(campaign.deadline)}</b></div>
        <div className={styles.campaignMeta}><span>Organizer</span><b>{shortHex(campaign.organizer)}</b></div>
        <div className={styles.campaignMeta}><span>Assignment grace</span><b>{formatDuration(campaign.assignmentGracePeriod)}</b></div>
        <div className={styles.campaignMeta}><span>Claim expiry</span><b>{formatDuration(campaign.claimExpiryWindow)}</b></div>
      </div>
      {!campaign.funded ? <div className={styles.warn} role="alert">Draft — awaiting funding. This reward is not claimable yet.</div> : null}
      {campaign.assignmentGracePeriod === 0n || campaign.claimExpiryWindow === 0n ? <div className={styles.warn} role="alert">⚠️ Warning: one or more timeout windows is 0 seconds; eligible funds may be reclaimed immediately.</div> : null}
      <h2 className={styles.sectionTitle}>Description</h2><p>{campaign.description || "No public description provided."}</p>
      <h2 className={styles.sectionTitle}>Winner slots</h2>
      {!campaign.winnerSlotCount ? <p className={styles.hint}>No winners assigned yet — assign winners after judging.</p> : <div className={styles.campaignActions}>{campaign.winnerSlots.map((slot) => <div className={styles.winnerRow} key={slot.slotId}><span>Slot {slot.slotId} · {formatTokenAmount(slot.amount, token.decimals)} {token.symbol}</span><span className={styles.statusPill}>{slot.claimed ? "Claimed" : "Unclaimed"}</span></div>)}</div>}
      <h2 className={styles.sectionTitle}>Applicants</h2>
      {applicants.length ? <div className={styles.campaignActions}>{applicants.map((applicant) => <div className={styles.winnerRow} key={applicant.applicant_address}><span>{applicant.applicant_address}</span><span className={styles.hint}>Applied</span></div>)}</div> : <p className={styles.hint}>No applicants yet.</p>}
      <OrganizerControls campaign={campaign} strk20Supported={strk20Supported} busy={busy[campaign.id]} onFund={(value) => fundCampaign(value)} onAssignWinners={async (value, splits) => { await assignWinners(value, splits); await refresh(); }} onSweepUnallocated={sweepUnallocated} />
      {campaign.winnerSlots.filter((slot) => campaign.funded && !slot.claimed && now > slot.assignedAt + campaign.claimExpiryWindow).map((slot) => <button key={`sweep-${slot.slotId}`} className={`${styles.btn} ${styles.btnSmall}`} disabled={busy[campaign.id] !== undefined} onClick={() => sweepExpiredSlot(campaign, slot.slotId)}>Sweep expired slot {slot.slotId}</button>)}
      {result ? <ResultCard r={result} isMainnet={isMainnet} /> : null}
    </section>
  </main>;
}
