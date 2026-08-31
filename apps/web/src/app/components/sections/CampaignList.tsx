import styles from "../../uni.module.css";
import type { Campaign } from "../../types";
import CampaignCard from "../campaign/CampaignCard";

export default function CampaignList({ campaigns, hasAnyCampaigns, loading, error, hasContracts, isConnected, statusTab, onRefresh, onHardRefresh }: {
  campaigns: Campaign[];
  hasAnyCampaigns: boolean;
  loading: boolean;
  error: string;
  hasContracts: boolean;
  isConnected: boolean;
  statusTab: "Active" | "Closed" | "Unfunded";
  onRefresh: () => void;
  onHardRefresh: () => void;
}) {
  return <section className={styles.section} id="campaigns">
    <h2 className={styles.sectionTitle}>Campaigns <span className={styles.refreshGroup}><button className={`${styles.refresh} ${loading ? styles.refreshSpin : ""}`} onClick={onRefresh} disabled={loading} title="Refresh campaign list from the chain">↻</button><button className={styles.refresh} onClick={onHardRefresh} title="Hard refresh — reload the app, bypassing the browser cache">⟳</button></span></h2>
    {error ? <div className={styles.warn}>{error}</div> : null}
    {error && !campaigns.length ? <div className={styles.hint}>Could not load campaigns: <b>{error}</b>. Check the connection and try the refresh button.</div> : null}
    {loading && !campaigns.length ? <><div className={styles.skeletonCard} aria-hidden="true" /><div className={styles.skeletonCard} aria-hidden="true" /><div className={styles.skeletonCard} aria-hidden="true" /></> : null}
    {!loading && !error && !hasAnyCampaigns && isConnected && !hasContracts ? <div className={styles.hint}>GameShield hasn&apos;t been deployed on this network yet.</div> : null}
    {!loading && !error && !hasAnyCampaigns && (hasContracts || !isConnected) ? <div className={styles.hint}>No campaigns yet. <a className={styles.footerLink} href="/create">Create the first one</a>.</div> : null}
    {!loading && campaigns.length ? campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />) : null}
    {!loading && hasAnyCampaigns && !campaigns.length && statusTab === "Active" ? <p className={styles.hint}>No active bounties right now.</p> : null}
    {!loading && hasAnyCampaigns && !campaigns.length && statusTab === "Closed" ? <p className={styles.hint}>No closed bounties yet.</p> : null}
    {!loading && hasAnyCampaigns && !campaigns.length && statusTab === "Unfunded" ? <p className={styles.hint}>No unfunded campaigns.</p> : null}
  </section>;
}
