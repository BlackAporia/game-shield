"use client";
import { create } from "zustand";
import { ProviderInterface, type WalletAccountV6 } from "starknet";
import { type WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";


// import { StarknetWindowObject } from "@/app/core/StarknetWindowObject";

export interface WalletState {
    StarknetWalletObject: WalletWithStarknetFeatures | undefined,
    setMyStarknetWalletObject: (wallet: WalletWithStarknetFeatures) => void,
    address: string,
    setAddressAccount: (address: string) => void,
    chain: string,
    setChain: (chain: string) => void,
    myWalletAccount: WalletAccountV6|undefined;
    setMyWalletAccount: (myWAccount:WalletAccountV6)=>void;
    provider: ProviderInterface | undefined,
    setProvider: (provider: ProviderInterface) => void,
    isConnected: boolean,
    setConnected: (isConnected: boolean) => void,
    resetWallet: () => void,
    displaySelectWalletUI: boolean,
    setSelectWalletUI: (displaySelectWalletUI: boolean) => void,
    walletApiList: string[],
    setWalletApiList: (version: string[]) => void,
selectedApiVersion: string,
    setSelectedApiVersion: (version: string) => void,
    strk20Supported: boolean | undefined,
    setStrk20Supported: (supported: boolean | undefined) => void,
    authStatus: "idle" | "verifying" | "verified" | "error",
    authError: string,
    setAuthStatus: (status: WalletState["authStatus"], error?: string) => void,

}

export const useStoreWallet = create<WalletState>()(set => ({
    StarknetWalletObject: undefined,
    setMyStarknetWalletObject: (wallet: WalletWithStarknetFeatures) => { set(state => ({ StarknetWalletObject: wallet })) },
    address: "",
    setAddressAccount: (address: string) => { set(state => ({ address })) },
    chain: "",
    setChain: (chain: string) => { set(state => ({ chain })) },
    myWalletAccount: undefined,
    setMyWalletAccount: (myWAccount: WalletAccountV6) => { set(state => ({ myWalletAccount: myWAccount })) },
    provider: undefined,
    setProvider: (provider: ProviderInterface) => { set(state => ({ provider })) },
    isConnected: false,
    setConnected: (isConnected: boolean) => { set(state => ({ isConnected })) },
    resetWallet: () => {
        set({
            StarknetWalletObject: undefined,
            address: "",
            chain: "",
            myWalletAccount: undefined,
            provider: undefined,
            isConnected: false,
            walletApiList: [],
            strk20Supported: undefined,
            authStatus: "idle",
            authError: "",
        })
    },
    displaySelectWalletUI: false,
    setSelectWalletUI: (displaySelectWalletUI: boolean) => { set(state => ({ displaySelectWalletUI })) },
    walletApiList: [],
    setWalletApiList: (walletApi: string[]) => { set(state => ({ walletApiList: walletApi })) },
    selectedApiVersion: "default",
    setSelectedApiVersion: (selectedApiVersion: string) => { set(state => ({ selectedApiVersion })) },
    strk20Supported: undefined,
    setStrk20Supported: (supported: boolean | undefined) => { set(state => ({ strk20Supported: supported })) },
    authStatus: "idle",
    authError: "",
    setAuthStatus: (authStatus, authError = "") => set({ authStatus, authError }),
    }));
