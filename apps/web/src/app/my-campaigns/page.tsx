"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../uni.module.css";
import { useStoreWallet } from "../components/Wallet/walletContext";
import * as constants from "../../utils/constants";
import { validateAddr } from "../../utils/campaigns";
import { useCampaigns } from "../hooks/useCampaigns";
import { useGameShieldActions } from "../hooks/useGameShieldActions";
import MyCampaignsView, { type ParticipantCampaign } from "../components/sections/MyCampaignsView";

export default function MyCampaignsPage() {
  const address = useStoreWallet((state) => state.address);
  const connected = useStoreWallet((state) => state.isConnected);
  const gameShieldAddress = constants.GameShieldAddress;
  const { campaigns, loading, error, refresh } = useCampaigns(gameShieldAddress);
  const { busy, results, sweepUnallocated, sweepExpiredSlot, claimWinner, claimRefund } = useGameShieldActions(gameShieldAddress);
  const [participants, setParticipants] = useState<ParticipantCampaign[]>([]);
  const [lookupError, setLookupError] = useState("");
  const [now, setNow] = useState(BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!address) { setParticipants([]); return; }
    let cancelled = false;
    setLookupError("");
    (async () => {
      const rows = await Promise.all(campaigns.map(async (campaign) => {
        const applicationsResponse = await fetch(`/api/organizer/applicants?campaign_id=${campaign.id}`);
        const applications: { applicant_address: string }[] = applicationsResponse.ok ? await applicationsResponse.json() : [];
        const applied = applications.some((application) => validateAddr(application.applicant_address) === validateAddr(address));
        const winnerSlots: ParticipantCampaign["winnerSlots"] = [];
        const claimedSlots: ParticipantCampaign["claimedSlots"] = [];
        await Promise.all(campaign.winnerSlots.map(async (slot) => {
          if (slot.claimed && validateAddr(slot.winnerAddress) === validateAddr(address)) claimedSlots.push(slot);
          else if (!slot.claimed && validateAddr(slot.winnerAddress) === validateAddr(address)) winnerSlots.push({ slot });
        }));
        return applied || winnerSlots.length || claimedSlots.length ? { campaign, applied, winnerSlots, claimedSlots } : null;
      }));
      if (!cancelled) setParticipants(rows.filter((row): row is ParticipantCampaign => row !== null));
    })().catch((reason: any) => { if (!cancelled) setLookupError(reason?.message ?? "Could not load participant campaigns."); });
    return () => { cancelled = true; };
  }, [address, campaigns]);

  const organizers = useMemo(() => address ? campaigns.filter((campaign) => validateAddr(campaign.organizer) === validateAddr(address)) : [], [address, campaigns]);
  if (!connected) return <main className={styles.main} style={{ paddingTop: 130 }}><section className={styles.section}><h2 className={styles.sectionTitle}>My Campaigns</h2><p className={styles.hint}>Connect and verify a wallet to view your campaigns.</p></section></main>;
  return <main className={styles.main} style={{ paddingTop: 130 }}><section className={styles.section}><h1 className={styles.sectionTitle}>My Campaigns</h1>{loading ? <p className={styles.hint}>Loading campaigns…</p> : null}{error ? <div className={styles.warn}>{error}</div> : null}{lookupError ? <div className={styles.warn}>{lookupError}</div> : null}</section><MyCampaignsView organizers={organizers} participants={participants} busy={busy} results={results} now={now} onReclaim={sweepUnallocated} onSweepSlot={sweepExpiredSlot} onClaimWinner={claimWinner} onClaimRefund={claimRefund} /></main>;
}
