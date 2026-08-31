import { num } from "starknet";

// ─── Supported reward tokens (mainnet) ──────────────────────────────────────
// Addresses verified via the AVNU token list and the STRK20 token list.
export type TokenInfo = {
  symbol: string;
  address: string;
  decimals: number;
  name: string;
};

export const REWARD_TOKENS: TokenInfo[] = [
  { symbol: "STRK", address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", decimals: 18, name: "Starknet" },
  { symbol: "ETH", address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", decimals: 18, name: "Ethereum" },
  { symbol: "USDC", address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8", decimals: 6, name: "USD Coin" },
  { symbol: "USDT", address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8", decimals: 6, name: "Tether USD" },
  { symbol: "DAI", address: "0x05574eb6b8789a91466f902c380d978e472db68170ff82a5b650b95a58ddf4ad", decimals: 18, name: "Dai Stablecoin" },
  { symbol: "WBTC", address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac", decimals: 8, name: "Wrapped BTC" },
  { symbol: "wstETH", address: "0x042b8f0484674ca266ac5d08e4ac6a3fe65bd3129795def2dca5c34ecc5f96d2", decimals: 18, name: "Wrapped Lido Staked ETH" },
  { symbol: "xSTRK", address: "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954c3d", decimals: 18, name: "Staked STRK" },
  { symbol: "LORDS", address: "0x0124aeb495b947201f5fac96fd1138e326ad86195b98df6dec9009158a533b49", decimals: 18, name: "Lords" },
  { symbol: "EKUBO", address: "0x075afe6402ad5a5c20dd25e10ec3b3986acaa647b77e4ae24b0cbc9a54a27a87", decimals: 18, name: "Ekubo Protocol" },
];

export function tokenByAddress(address: string): TokenInfo {
  const a = num.toHex(num.toBigInt(address));
  return (
    REWARD_TOKENS.find((t) => num.toHex(t.address) === a) ?? {
      symbol: "TOKEN",
      address: a,
      decimals: 0,
      name: "Unknown token",
    }
  );
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const pow = 10n ** BigInt(decimals);
  const whole = amount / pow;
  const frac = (amount % pow).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const match = value.trim().match(new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`));
  if (!match) throw new Error(`Enter a valid amount with up to ${decimals} decimals.`);
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
  const amount = whole * 10n ** BigInt(decimals) + fraction;
  if (amount <= 0n) throw new Error("Enter an amount > 0.");
  return amount;
}

export function symbolFor(address: string): string {
  return tokenByAddress(address).symbol;
}
