"use client";

import styles from "../uni.module.css";
import { useStoreWallet } from "../components/Wallet/walletContext";
import { constants as SNconstants } from "starknet";
import * as constants from "../../utils/constants";
import CreateCampaignForm from "../components/sections/CreateCampaignForm";
import { useGameShieldActions } from "../hooks/useGameShieldActions";

export default function CreatePage() {
  const isConnected = useStoreWallet((s) => s.isConnected);
  const chain = useStoreWallet((s) => s.chain);
  const isMainnet = chain === SNconstants.StarknetChainId.SN_MAIN;
  const gameShieldAddress = constants.GameShieldAddress;
  const deploymentConfigured = gameShieldAddress !== "0x0" && gameShieldAddress !== "";

  const { createBusy, resultCreate, createCampaign } = useGameShieldActions(gameShieldAddress);

  return (
    <main className={styles.main} style={{ paddingTop: 130 }}>
      <CreateCampaignForm
        isConnected={isConnected}
        isMainnet={isMainnet}
        deploymentConfigured={deploymentConfigured}
        onCreate={createCampaign}
        result={resultCreate}
        busy={createBusy}
      />
    </main>
  );
}
