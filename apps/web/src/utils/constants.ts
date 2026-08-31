import { ProviderInterface, RpcProvider } from "starknet";

// ─── GameShield config ──────────────────────────────────────────────────────

// The ERC-20 GameShield moves privately: STRK on Starknet (mainnet + sepolia use
// the same address).
export const addrSTRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// The active deployment is selected by environment at startup. Change these
// values and restart/redeploy the app when moving between networks.
export const PoolAddress = process.env.NEXT_PUBLIC_STRK20_POOL_ADDRESS ?? "0x0";

// One active RPC provider per deployment.
export const myFrontendProvider: ProviderInterface = new RpcProvider({
  nodeUrl: process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "",
});

// ─── GameShield contract ─────────────────────────────────────────────────────

// One contract address per deployment.
export const GameShieldAddress = process.env.NEXT_PUBLIC_GAMESHIELD_CONTRACT_ADDRESS ?? "0x0";
