"use client";
import styles from "../../../uni.module.css";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useEffect, useState } from "react";
import { walletV6, validateAndParseAddress, constants as SNconstants, compareVersions, WalletAccountV6 } from "starknet";
import { WALLET_API } from "@starknet-io/types-js";
import { myFrontendProvider } from "@/utils/constants";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type {
  WalletWithStarknetFeatures,
} from '@starknet-io/get-starknet-wallet-standard/features';


// Normalize wallet identifiers so starknetkit's connector id / SWO name
// ("argentX", "Ready", "Braavos") can be matched against the wallet-standard
// wallet's display name ("Argent X", "Braavos", ...).
function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// STRK20 Wallet API methods (strk20InvokeTransaction / strk20Balances / …)
// were introduced in API version 0.10.3; any version >= 0.10.3 means the
// wallet can perform shielded actions.
const STRK20_MIN_VERSION = "0.10.3";

function supportsStrk20(versions: string[] | undefined): boolean {
  if (!Array.isArray(versions)) return false;
  return versions.some((v) => compareVersions(v, STRK20_MIN_VERSION) >= 0);
}

export default function SelectWallet({ variant = "ctaBig" }: { variant?: "nav" | "ctaBig" }) {

  const setMyWallet = useStoreWallet(state => state.setMyStarknetWalletObject);

  const setMyWalletAccount = useStoreWallet(state => state.setMyWalletAccount);

  const isConnected = useStoreWallet(state => state.isConnected);
  const setConnected = useStoreWallet(state => state.setConnected);
  const resetWallet = useStoreWallet(state => state.resetWallet);
  const address = useStoreWallet(state => state.address);
  const strk20Supported = useStoreWallet(state => state.strk20Supported);
  const setStrk20Supported = useStoreWallet(state => state.setStrk20Supported);
  const setAuthStatus = useStoreWallet(state => state.setAuthStatus);
  const authStatus = useStoreWallet(state => state.authStatus);
  const authError = useStoreWallet(state => state.authError);

  const setWalletApi = useStoreWallet(state => state.setWalletApiList);

  const setChain = useStoreWallet(state => state.setChain);
  const setAddressAccount = useStoreWallet(state => state.setAddressAccount);

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [authErrorDismissed, setAuthErrorDismissed] = useState(false);
  // Detected Starknet wallets, in render state so the picker updates as wallets register.
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [lastWallet, setLastWallet] = useState<WalletWithStarknetFeatures | undefined>();

  useEffect(() => {
    if (authStatus === "error") setAuthErrorDismissed(false);
  }, [authStatus]);

  // Create the discovery store once on mount so wallets have time to register
  // before the user opens the picker. eip1193Adapters:[] keeps MetaMask out entirely
  // (no EIP-6963 MetaMask bridging / Snap probing).
  useEffect(() => {
    try {
      const store: Store = createStore({ eip1193Adapters: [] });
      setWallets(store.getWallets().slice());
      const unsub = store.subscribe((next) => setWallets(next.slice()));
      return () => unsub();
    } catch (err: any) {
      setError(err?.message?.toLowerCase().includes("locked") ? "Unlock your wallet extension and try again." : err?.message ?? "Could not discover a wallet extension.");
      return undefined;
    }
  }, []);

  // Show every native Starknet wallet except MetaMask. Wallet API and STRK20
  // compatibility are verified by the action preflight instead of a name allowlist.
  const pickable = wallets.filter((w) => {
    const id = normalizeId(w.name);
    return !id.includes("metamask");
  });

  // Unchanged connection flow: takes the wallet-standard wallet and populates
  // the zustand store with a WalletAccountV6 + account/chain/permissions.
  async function handleSelectedWallet(selectedWallet: WalletWithStarknetFeatures) {
    setMyWallet(selectedWallet); // zustand
    setStrk20Supported(undefined);
    const result = await walletV6.requestAccounts(selectedWallet);
    if (typeof (result) == "string") {
      throw new Error("This wallet is not compatible.");
    }
    if (!Array.isArray(result) || !result[0]) throw new Error("This wallet did not return an account.");
    const addr = validateAndParseAddress(result[0]);
    if (Array.isArray(result)) {
      setAddressAccount(addr); // zustand
    }
    const isConnectedWallet: boolean = await walletV6.getPermissions(selectedWallet).then((res: any) => (res as WALLET_API.Permission[]).includes(WALLET_API.Permission.ACCOUNTS));
    setConnected(isConnectedWallet); // zustand
    if (isConnectedWallet) {
      const chainId = (await walletV6.requestChainId(selectedWallet)) as string;
      const myWA = await WalletAccountV6.connect(myFrontendProvider, selectedWallet);
      setMyWalletAccount(myWA);
      setChain(chainId);

      setAuthStatus("verifying");
      try {
        const challengeResponse = await fetch("/api/auth/challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: addr }),
        });
        const challenge = await challengeResponse.json();
        if (!challengeResponse.ok) throw new Error(challenge.error ?? "Could not create sign-in challenge.");

        console.log("[SIWE] signing nonce:", challenge.message.message.nonce, "length:", challenge.message.message.nonce.length);
        const signature = await myWA.signMessage(challenge.message);
        const verifyResponse = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: addr, signature }),
        });
        const verification = await verifyResponse.json();
        if (!verifyResponse.ok) throw new Error(verification.error ?? "Wallet sign-in failed.");
        setAuthStatus("verified");
      } catch (authError: any) {
        setAuthStatus("error", authError?.message ?? "Wallet sign-in failed.");
        throw authError;
      }
    }
    setWalletApi(await walletV6.supportedSpecs(selectedWallet));
    try {
      const apiVersions = await walletV6.supportedWalletApi(selectedWallet);
      setStrk20Supported(supportsStrk20(apiVersions));
    } catch {
      setStrk20Supported(false);
    }
  }

  // Open the wallet picker so the user can choose (Ready, Xverse, ...).
  const openPicker = () => {
    setError("");
    setPickerOpen(true);
  };

  // Connect the wallet the user picked from the modal.
  //
  // We deliberately do NOT use starknetkit's connect() here: it bundles
  // get-starknet-core, whose MetaMask detection (waitForMetaMaskProvider, retries:3)
  // repeatedly dispatches EIP-6963 discovery and probes MetaMask's Starknet Snap,
  // spamming its unlock popup. eip1193Adapters:[] above keeps MetaMask out of discovery
  // entirely, and only the picked wallet ever receives a request().
  async function selectWallet(w: WalletWithStarknetFeatures) {
    setError("");
    setConnecting(true);
    setLastWallet(w);
    try {
      await handleSelectedWallet(w);
      setPickerOpen(false);
    } catch (err: any) {
      setError(err?.message ?? "Wallet connection failed.");
    } finally {
      setConnecting(false);
    }
  }

  async function retryAuth() {
    if (!lastWallet || connecting) return;
    setError("");
    setConnecting(true);
    try {
      await handleSelectedWallet(lastWallet);
    } catch (err: any) {
      setError(err?.message ?? "Wallet connection failed.");
    } finally {
      setConnecting(false);
    }
  }

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  const authIndicator = authStatus === "verifying" ? (
    <span className={styles.hint} role="status" aria-live="polite">Verifying wallet…</span>
  ) : authStatus === "verified" ? (
    <span className={styles.hint} role="status" aria-live="polite">Signed in</span>
  ) : null;

  const authToast = authStatus === "error" && !authErrorDismissed ? (
    <div className={`${styles.warn} ${styles.authToast}`} role="alert" aria-live="assertive">
      <span>
        Sign-in failed — {authError || "please try again."}{" "}
        <button type="button" className={styles.footerLink} onClick={retryAuth} disabled={connecting}>Click to retry</button>
      </span>
      <button
        type="button"
        className={styles.modalClose}
        onClick={() => setAuthErrorDismissed(true)}
        aria-label="Dismiss sign-in error"
      >
        ×
      </button>
    </div>
  ) : null;

  const picker = pickerOpen ? (
    <div className={styles.modalOverlay} onClick={() => !connecting && setPickerOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>Connect a wallet</span>
          <button
            className={styles.modalClose}
            onClick={() => setPickerOpen(false)}
            aria-label="Close"
            disabled={connecting}
          >
            ×
          </button>
        </div>

        {pickable.length ? (
          <div className={styles.walletList}>
            {pickable.map((w) => (
              <button
                key={w.name}
                className={styles.walletRow}
                onClick={() => selectWallet(w)}
                disabled={connecting}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.walletIcon} src={w.icon} alt="" />
                <span className={styles.walletName}>{w.name}</span>
                <span className={styles.walletGo}>{connecting ? "…" : "→"}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.walletHint}>
            No Starknet wallet detected. Install{" "}
            <a href="https://www.ready.co/" target="_blank" rel="noreferrer">Ready</a> or{" "}
            <a href="https://www.xverse.app/" target="_blank" rel="noreferrer">Xverse</a>.
          </div>
        )}

        {error ? <div className={styles.errorText}>{error}</div> : null}
      </div>
    </div>
  ) : null;

  // Nav variant: a compact Connect pill, or the connected address with disconnect.
  if (variant === "nav") {
    if (isConnected && address) {
      return (
        <>
          <div className={styles.walletPanel}>
            <button
              className={styles.addrPill}
              onClick={resetWallet}
              title="Disconnect"
            >
              <span className={styles.addrDot} />
              {shortAddr}
              <span className={styles.addrDisconnect}>Disconnect</span>
            </button>
            {strk20Supported === false ? (
              <span
                className={styles.strk20Warn}
              title="This wallet does not advertise STRK20 Wallet API methods. Campaign funding is disabled; claims and organizer actions still work."
              >
                STRK20 not supported — Funding disabled
              </span>
            ) : null}
            {authIndicator}
          </div>
          {authToast}
        </>
      );
    }
    return (
      <>
        <button className={styles.connectPill} onClick={openPicker}>
          Connect
        </button>
        {picker}
      </>
    );
  }

  // Default (ctaBig): the large solid connect CTA shown in the panel until a
  // wallet is connected.
  return (
    <>
      {authIndicator}
      {authToast}
      <button className={styles.btnCta} onClick={openPicker}>
        Connect a Wallet
      </button>
      {picker}
    </>
  );
}
