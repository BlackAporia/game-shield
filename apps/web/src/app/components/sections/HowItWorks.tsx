import styles from "../../uni.module.css";

export default function HowItWorks() {
  return (
    <section className={styles.workflow} id="how-it-works">
      <div className={styles.workflowHead}>
        <span className={styles.eyebrow}>How it works</span>
        <h2>Four steps, flexible rewards</h2>
        <p>
          GameShield locks the reward in the contract when it's funded, then pays each
          assigned winner directly from the campaign's reward pot.
        </p>
      </div>
      <div className={styles.workflowGrid}>
        <article className={styles.workflowStep}>
          <span>01</span>
          <h3>Create bounty</h3>
          <p>Set the reward, token and deadline. The bounty itself is public — anyone can see it exists.</p>
        </article>
        <article className={styles.workflowStep}>
          <span>02</span>
          <h3>Fund it</h3>
          <p>The reward is locked in the contract, not just sitting in the organizer's wallet — it can't be promised and then withheld.</p>
        </article>
        <article className={styles.workflowStep}>
          <span>03</span>
          <h3>Assign winner slots</h3>
          <p>The organizer reviews wallet applications and can assign one or more independent reward slots, each with its own amount.</p>
        </article>
        <article className={styles.workflowStep}>
          <span>04</span>
          <h3>Claim your reward</h3>
          <p>Only the wallet assigned to a slot can claim its amount. The claim is a single on-chain transaction, paid directly to that wallet.</p>
        </article>
      </div>
      <details className={styles.privacyDetails} open>
        <summary>Where do I shield or unshield tokens?</summary>
        <div className={styles.hint}>
          <p>Directly in your wallet — not here. Ready and Xverse both build shielding into the wallet itself: open the wallet, pick the asset, and shield it in one click. Unshielding back to a public balance is the same, one click, no waiting.</p>
          <p>Fund a campaign from your <b>shielded</b> balance in that wallet. Claiming is a direct on-chain payout to the assigned winner&apos;s public wallet. GameShield doesn&apos;t hold a separate shielding feature of its own.</p>
          <p>Don&apos;t have a shielded balance yet? Open Ready or Xverse, find the shield toggle for your token, and turn it on before funding a campaign here.</p>
        </div>
      </details>
      <details className={styles.privacyDetails}>
        <summary>How does privacy work?</summary>
        <div className={styles.hint}>
          <p>GameShield uses the STRK20 privacy pool for campaign funding. Your wallet performs the shielded deposit, and the pool sends the requested amount to the campaign contract.</p>
          <p>Winner addresses, slot amounts, campaign details, and direct claim transfers are public on-chain data by design.</p>
          <p>GameShield does not include its own shield or unshield screen. Use Ready or Xverse for those wallet actions; GameShield only requests the funding action when you fund a campaign.</p>
        </div>
      </details>
    </section>
  );
}
