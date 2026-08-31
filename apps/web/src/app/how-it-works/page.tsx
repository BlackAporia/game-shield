import styles from "../uni.module.css";
import HowItWorks from "../components/sections/HowItWorks";

export default function HowItWorksPage() {
  return (
    <main className={styles.main} style={{ paddingTop: 130 }}>
      <HowItWorks />
    </main>
  );
}
