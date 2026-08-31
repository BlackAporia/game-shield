"use client";

import { useRouter } from "next/navigation";
import styles from "../../uni.module.css";
import type { Campaign } from "../../types";
import { formatTokenAmount, symbolFor, tokenByAddress } from "../../../utils/tokens";
import { fmtDeadline, decodeFeltString } from "../../../utils/format";

export default function CampaignCard({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const destination = `/campaign/${campaign.id}`;
  const open = () => router.push(destination);
  const title = decodeFeltString(campaign.title) || `Campaign #${campaign.id}`;
  return <article className={styles.campaignCard} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }} role="link" tabIndex={0}>
    <div className={styles.campaignHead}>
      <span className={styles.campaignId}>#{campaign.id}</span>
      <span className={`${styles.statusPill} ${campaign.funded ? styles.statusActive : styles.statusCancel}`}>{campaign.funded ? "Funded" : "Draft — awaiting funding"}</span>
    </div>
    <div className={styles.campaignIntro}><h3>{title}</h3><p>{campaign.description || "No description provided."}</p></div>
    <div className={styles.campaignBody}>
      <div className={styles.campaignMeta}><span>Reward</span><b>{formatTokenAmount(campaign.rewardAmount, tokenByAddress(campaign.token).decimals)} {symbolFor(campaign.token)}</b></div>
      <div className={styles.campaignMeta}><span>Deadline</span><b>{fmtDeadline(campaign.deadline)}</b></div>
    </div>
  </article>;
}
