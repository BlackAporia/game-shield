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
  process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ??
  "0x02d74df1009ea1cd63ddf676a1d68abd6c2aa0da9e44aa9199006cfda5f9ec3e";
export const HelperAddress =
  process.env.NEXT_PUBLIC_HELPER_ADDRESS ??
  "0x01108f56778d7c137deb6c7d0f602311b6a867e649fdfa460d93eb36d7cc27a9";

// Frontend provider indices where the STRK20 privacy pool is available.
export const Strk20Networks: Record<number, string> = { 0: "MAINNET", 1: "SEPOLIA" };