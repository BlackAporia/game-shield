import { ProviderInterface, RpcProvider } from "starknet";

// ─── GameShield config ──────────────────────────────────────────────────────

// The ERC-20 GameShield moves privately: STRK on Starknet (mainnet + sepolia use
// the same address).
export const addrSTRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// STRK20 privacy pool (mainnet).
export const PoolAddress = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

// Frontend RPC providers, indexed. Index 0 = Mainnet, index 1 = Sepolia.
// NEXT_PUBLIC_RPC_MAINNET / NEXT_PUBLIC_RPC_SEPOLIA override the defaults
// (free public endpoints; an Alchemy key works too).
export const myFrontendProviders: ProviderInterface[] = [
  new RpcProvider({
    nodeUrl:
      process.env.NEXT_PUBLIC_RPC_MAINNET ??
      "https://rpc.starknet.lava.build",
  }),
  new RpcProvider({
    nodeUrl:
      process.env.NEXT_PUBLIC_RPC_SEPOLIA ??
      "https://starknet-sepolia.public.blastapi.io/rpc/v0_8",
  }),
];

// ─── GameShield contracts ────────────────────────────────────────────────────

// Campaign registry (public campaign state) and payout helper (privacy_invoke
// entry point called by the STRK20 pool). Set after deployment:
//   NEXT_PUBLIC_REGISTRY_ADDRESS
//   NEXT_PUBLIC_HELPER_ADDRESS
export const RegistryAddress =
  process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "0x0";
export const HelperAddress =
  process.env.NEXT_PUBLIC_HELPER_ADDRESS ?? "0x0";

// Frontend provider indices where the STRK20 privacy pool is available.
export const Strk20Networks: Record<number, string> = { 0: "MAINNET", 1: "SEPOLIA" };

// ─── GameShield Swap & Bridge ────────────────────────────────────────────────

// GameShield earns a small integrator fee on every AVNU swap (0.25% = 25 bps).
export const AVNU_FEE_BPS = 25;
export const AVNU_FEE_RECIPIENT = "0x4c5a81396849724434ca58bdccdc68177ac6db5ef219823361795fa877c043a";
export const AVNU_INTEGRATOR_NAME = "GameShield";

export type BridgeProvider = {
  id: string;
  name: string;
  url: string;
  note: string;
  fee: string;
  chain?: "starknet" | "near";
};

export const BRIDGE_PROVIDERS: BridgeProvider[] = [
  {
    id: "starkgate",
    name: "StarkGate (official)",
    url: "https://starkgate.starknet.io",
    note: "Official Starknet bridge — Ethereum L1 ⇄ L2, no fees.",
    fee: "no fee",
  },
  {
    id: "layerswap",
    name: "Layerswap",
    url: "https://www.layerswap.io/app",
    note: "CEX ↔ Starknet and cross-chain transfers in minutes.",
    fee: "affiliate",
  },
  {
    id: "near-intents",
    name: "NEAR Intents",
    url: "https://intents.near.org",
    note: "Cross-chain intent settlement powered by NEAR.",
    fee: "intent fee",
  },
  {
    id: "orbiter",
    name: "Orbiter",
    url: "https://www.orbiter.finance",
    note: "Instant cross-rollup transfers.",
    fee: "market fee",
  },
];