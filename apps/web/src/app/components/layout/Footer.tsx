"use client";

import styles from "../../uni.module.css";
import { useStoreWallet } from "../Wallet/walletContext";
import { constants as SNconstants } from "starknet";

export default function Footer() {
  const chain = useStoreWallet((s) => s.chain);
  const networkName = chain === SNconstants.StarknetChainId.SN_MAIN ? "MAINNET" : chain === SNconstants.StarknetChainId.SN_SEPOLIA ? "SEPOLIA" : "UNKNOWN NETWORK";

  return (
    <footer className={styles.footer}>
      <span>Powered by STRK20 privacy pool · Starknet.js v10.4</span>
      <span className={styles.footerDot}>·</span>
      <span>{networkName ?? "unknown network"}</span>
    </footer>
  );
}
