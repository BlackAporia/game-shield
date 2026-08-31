"use client";

import { useState } from "react";
import styles from "../../uni.module.css";
import { REWARD_TOKENS, parseTokenAmount, symbolFor, tokenByAddress } from "../../../utils/tokens";
import { defaultDeadline } from "../../../utils/format";
import { tokenIcon } from "../TokenIcons";
import ResultCard from "../shared/ResultCard";
import type { ActionResult } from "../../types";

const DURATION_OPTIONS = [["0", "0 seconds"], ["86400", "1 day"], ["259200", "3 days"], ["604800", "7 days"], ["2592000", "30 days"]] as const;

export default function CreateCampaignForm({ isConnected, isMainnet, deploymentConfigured, onCreate, result, busy }: {
  isConnected: boolean;
  isMainnet: boolean;
  deploymentConfigured: boolean;
  onCreate: (input: { title: string; rewardAmount: string; token: string; deadlineAt: string; description: string; assignmentGracePeriod: string; claimExpiryWindow: string }) => void;
  result: ActionResult | null;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [reward, setReward] = useState("10");
  const [token, setToken] = useState(REWARD_TOKENS[0].address);
  const [deadlineAt, setDeadlineAt] = useState(defaultDeadline);
  const [description, setDescription] = useState("");
  const [assignmentGracePeriod, setAssignmentGracePeriod] = useState("259200");
  const [claimExpiryWindow, setClaimExpiryWindow] = useState("259200");
  const [validationError, setValidationError] = useState("");
  const Icon = tokenIcon(symbolFor(token));
  const disabled = !isConnected || !deploymentConfigured || busy;
  const zeroWindow = assignmentGracePeriod === "0" || claimExpiryWindow === "0";

  const submit = () => {
    const titleValue = title.trim();
    if (!titleValue) return setValidationError("Enter a campaign title.");
    let rewardAmount: bigint;
    try { rewardAmount = parseTokenAmount(reward, tokenByAddress(token).decimals); }
    catch (error: any) { return setValidationError(error?.message ?? "Enter a valid reward amount."); }
    if (rewardAmount === 0n) return setValidationError("Reward amount must be greater than zero.");
    const deadlineSeconds = Math.floor(new Date(deadlineAt).getTime() / 1000);
    if (!Number.isFinite(deadlineSeconds) || deadlineSeconds <= Math.floor(Date.now() / 1000)) return setValidationError("Choose a deadline in the future.");
    if (tokenByAddress(token).address === "0x0") return setValidationError("Choose a valid reward token.");
    setValidationError("");
    onCreate({ title: titleValue, rewardAmount: rewardAmount.toString(), token, deadlineAt, description, assignmentGracePeriod, claimExpiryWindow });
  };

  return <section className={styles.section}>
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>New campaign</span><h2 className={styles.sectionTitle}>Create a gaming bounty</h2></div><p>Set the on-chain reward, deadline, winner-assignment timing, and a public campaign description.</p></div>
    <div className={styles.campaignForm}>
      <label className={`${styles.field} ${styles.fieldWide}`}><span>Campaign title</span><input className={styles.input} placeholder="Summer speedrun challenge" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className={styles.field}><span>Reward · human-readable {symbolFor(token)}</span><div className={styles.formRow}><input className={styles.input} inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} /><span className={styles.tokenPicker}><Icon size={22} className={styles.tokenBadge} title={symbolFor(token)} /><select className={styles.input} value={token} onChange={(e) => setToken(e.target.value)}>{REWARD_TOKENS.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}</select></span></div><small>Converted to base units on submission.</small></label>
      <label className={styles.field}><span>Ends at · your local time</span><input className={styles.input} type="datetime-local" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)} /></label>
      <label className={styles.field}><span>Assignment grace period</span><select className={styles.input} value={assignmentGracePeriod} onChange={(e) => setAssignmentGracePeriod(e.target.value)}>{DURATION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className={styles.field}><span>Claim expiry window</span><select className={styles.input} value={claimExpiryWindow} onChange={(e) => setClaimExpiryWindow(e.target.value)}>{DURATION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className={`${styles.field} ${styles.fieldFull}`}><span>Public description and rules</span><textarea className={`${styles.input} ${styles.textarea}`} placeholder="Describe eligibility, game mode, scoring, deliverables, winner selection and reward conditions…" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /><small>{description.length}/2000 · Publicly readable; only the authenticated organizer can write it.</small></label>
      <div className={styles.formSubmit}><span>After the deadlines pass, eligible unallocated funds or expired winner slots can be swept into the organizer&apos;s refund pool.</span><button className={styles.btnCta} onClick={submit} disabled={disabled}>{busy ? "Creating…" : "Create campaign"}</button></div>
    </div>
    {!isConnected ? <div className={styles.hint}>Connect a wallet to create and manage campaigns.</div> : null}
    {!deploymentConfigured ? <div className={styles.warn} role="alert">Campaign creation is unavailable because no GameShield deployment is configured for this network.</div> : null}
    {zeroWindow ? <div className={styles.warn} role="alert">⚠️ Warning: a 0-second grace or expiry window allows eligible funds to be reclaimed immediately.</div> : null}
    {validationError ? <div className={styles.warn} role="alert">{validationError}</div> : null}
    {result ? <ResultCard r={result} isMainnet={isMainnet} /> : null}
  </section>;
}
