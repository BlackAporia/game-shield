"use client";

import styles from "../../uni.module.css";
import type { Campaign } from "../../types";

export default function ClaimPanel({
  campaign,
  connectedAddress,
  onClaim,
  busy,
}: {
  campaign: Campaign;
  connectedAddress: string | null;
  onClaim: (slot: number) => void;
  busy: string | undefined;
}) {
  if (campaign.status !== "resolved" || campaign.claimed) return null;
  const winnerSlot = campaign.winnerSlots.find((candidate) => !candidate.claimed && connectedAddress && candidate.winnerAddress.toLowerCase() === connectedAddress.toLowerCase());
  if (!connectedAddress) return <div className={styles.winnerRow}><span className={styles.hint}>Connect the winning wallet to claim.</span></div>;
  if (!winnerSlot) return null;

  return (
    <div className={styles.winnerRow}>
      {winnerSlot ? (
        <>
          <span className={styles.hint}>You won! Claim your reward.</span>
          <button
            className={`${styles.btn} ${styles.btnGreen} ${styles.btnSmall}`}
            disabled={busy !== undefined}
            onClick={() => onClaim(winnerSlot.slotId)}
          >
            {busy === "claim" ? "Claiming…" : "Claim reward"}
          </button>
        </>
      ) : null}
    </div>
  );
}
