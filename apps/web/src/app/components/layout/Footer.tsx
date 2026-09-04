"use client";

import styles from "../../uni.module.css";
import { useStoreWallet } from "../Wallet/walletContext";
import { constants as SNconstants } from "starknet";
import Image from "next/image";

export default function Footer() {
  const chain = useStoreWallet((s) => s.chain);
  const networkName = chain === SNconstants.StarknetChainId.SN_MAIN ? "MAINNET" : chain === SNconstants.StarknetChainId.SN_SEPOLIA ? "SEPOLIA" : "UNKNOWN NETWORK";

  return (
    <footer className={styles.footer}>
      <span>Powered by STRK20 privacy pool · Starknet.js v10.4</span>
      <span className={styles.footerDot}>·</span>
      <span>{networkName ?? "unknown network"}</span>
      <span className={styles.footerDot}>·</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: 0.8 }}>
        Thanks to StarkRelay
        <a href="https://starkrelay.bond/" target="_blank" rel="noopener noreferrer">
          <Image src="/starkrelay.png" alt="StarkRelay logo" width={100} height={28} style={{ width: "auto", height: "28px" }} />
        </a>
      </span>
    </footer>
  );
}
