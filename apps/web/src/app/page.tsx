"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./uni.module.css";
import { useStoreWallet } from "./components/Wallet/walletContext";
import * as constants from "../utils/constants";
import { matchesCampaignSearch } from "../utils/search";
import { deriveCampaignStatus } from "../utils/campaignStatus";
import { validateAddr } from "../utils/campaigns";

import Hero from "./components/sections/Hero";
import CampaignList from "./components/sections/CampaignList";

import { useCampaigns } from "./hooks/useCampaigns";

// Landing page: hero + the campaign list itself, since browsing/funding/
// claiming campaigns is the actual point of the app. "How it works" and
// "Create a bounty" each live on their own route now (see
// components/layout/NavBar.tsx and the hero CTAs). Shielding/unshielding
// isn't built here at all — Ready and Xverse already do it natively,
// one click, inside the wallet itself. See /how-it-works.
export default function Page() {
  const isConnected = useStoreWallet((s) => s.isConnected);
  const address = useStoreWallet((s) => s.address);
  const gameShieldAddress = constants.GameShieldAddress;
  const hasContracts = gameShieldAddress !== "0x0" && gameShieldAddress !== "";

  const { campaigns, loading, error, refresh } = useCampaigns(gameShieldAddress);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(BigInt(Math.floor(Date.now() / 1000)));
  const [statusTab, setStatusTab] = useState<"Active" | "Closed" | "Unfunded">("Active");
  const filteredCampaigns = useMemo(
    () => campaigns.filter((c) => matchesCampaignSearch(c, search)),
    [campaigns, search],
  );
  const visibleCampaigns = useMemo(() => filteredCampaigns.filter((campaign) => {
    const status = deriveCampaignStatus(campaign, now);
    return statusTab === "Unfunded" ? status === "Draft" : status === statusTab;
  }), [filteredCampaigns, now, statusTab]);
  const winningSlots = useMemo(() => address ? campaigns.flatMap((campaign) => campaign.winnerSlots.filter((slot) => !slot.claimed && validateAddr(slot.winnerAddress) === validateAddr(address)).map((slot) => ({ campaign, slot }))) : [], [address, campaigns]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 30000); return () => window.clearInterval(timer); }, []);

  const hardRefresh = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("_", Date.now().toString());
    window.location.href = url.toString();
  };

  return (
    <>
      <Hero />
      <main className={styles.main}>
        {!hasContracts ? (
          <div className={styles.hint}>
            Preview data below — GameShield hasn&apos;t been deployed on this network yet.
          </div>
        ) : null}
        {winningSlots.length ? <div className={styles.warn} role="status">You won! Claim your reward{winningSlots.length > 1 ? "s" : ""}. <a className={styles.footerLink} href="/my-campaigns">Open My Campaigns</a></div> : null}
        <div className={styles.formRow} style={{ margin: "0 0 18px" }}>
          <input
            className={styles.input}
            placeholder="Search campaigns by title, token, or organizer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.formRow} style={{ margin: "0 0 18px" }} role="tablist" aria-label="Campaign status">
          {(["Active", "Closed", "Unfunded"] as const).map((tab) => <button key={tab} className={`${styles.btn} ${statusTab === tab ? styles.btnGreen : ""}`} role="tab" aria-selected={statusTab === tab} onClick={() => setStatusTab(tab)}>{tab}</button>)}
        </div>
        <CampaignList
          campaigns={visibleCampaigns}
          hasAnyCampaigns={filteredCampaigns.length > 0}
          loading={loading}
          error={error}
          hasContracts={hasContracts}
          isConnected={isConnected}
          statusTab={statusTab}
          onRefresh={refresh}
          onHardRefresh={hardRefresh}
        />
      </main>
    </>
  );
}
