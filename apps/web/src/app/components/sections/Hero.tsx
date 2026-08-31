import Link from "next/link";
import styles from "../../uni.module.css";

export default function Hero() {
  return (
    <header className={styles.hero}>
      <span className={styles.eyebrow}>STRK20 Private Sprint 2026</span>
      <h1 className={styles.heroTitle}>
        Flexible Rewards
        <br />
        <span className={styles.heroAccent}>for Onchain Games</span>
      </h1>
      <p className={styles.heroSub}>
        GameShield lets games fund a campaign through STRK20, assign multiple reward
        slots to wallet addresses, and pay each winner their own amount.
      </p>
      <div className={styles.heroCtas}>
        <Link className={styles.btnCta} href="/create">Create a bounty</Link>
        <Link className={styles.btn} href="/how-it-works">How it works</Link>
      </div>
    </header>
  );
}
