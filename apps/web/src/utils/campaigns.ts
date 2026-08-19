import { Abi, Contract, hash, num, ProviderInterface } from "starknet";
import registryAbi from "../contracts/CampaignRegistry.json";
import registryV1Abi from "../contracts/CampaignRegistryV1.json";
import { addrSTRK } from "./constants";

// On-chain status of a campaign, matching CampaignStatus in campaign_registry.cairo.
export const CAMPAIGN_STATUS = ["Active", "Completed", "Cancelled"] as const;
export type CampaignStatusName = (typeof CAMPAIGN_STATUS)[number];

export type Campaign = {
  id: number;
  organizer: string;
  token: string;
  rewardAmount: bigint;
  deadline: bigint;
  criteriaHash: string;
  status: number;
  winnerCommitment: string;
  paid: boolean;
  title: string;
};

// Class hash of the legacy v1 CampaignRegistry (already declared on Mainnet).
// v1 has no on-chain `title`/`token` and its create_campaign takes 3 arguments.
export const CAMPAIGN_REGISTRY_V1 = "0x43f1247fc09a89c13d776d13e8b6c7814d93193b64c0615e10238392edf038";

const classHashCache = new Map<string, string>();

export async function registryClassHash(
  provider: ProviderInterface,
  address: string
): Promise<string> {
  const key = validateAddr(address);
  const cached = classHashCache.get(key);
  if (cached) return cached;
  const classHash = await provider.getClassHashAt(address);
  classHashCache.set(key, classHash);
  return classHash;
}

export async function isRegistryV1(
  provider: ProviderInterface,
  address: string
): Promise<boolean> {
  try {
    const classHash = await registryClassHash(provider, address);
    return num.toHex(num.toBigInt(classHash)) === num.toHex(num.toBigInt(CAMPAIGN_REGISTRY_V1));
  } catch {
    return false;
  }
}

async function registryAbiFor(
  provider: ProviderInterface,
  address: string
): Promise<Abi> {
  return (await isRegistryV1(provider, address) ? registryV1Abi : registryAbi) as Abi;
}

export async function registryContract(
  provider: ProviderInterface,
  address: string
): Promise<Contract> {
  const abi = await registryAbiFor(provider, address);
  return new Contract({ abi, address, providerOrAccount: provider });
}

export function statusName(status: number): CampaignStatusName {
  return CAMPAIGN_STATUS[status] ?? "Active";
}

// starknet.js v10 parses Cairo enums as { variant: { Active: {}, Completed:
// undefined, Cancelled: undefined } } — every enum key is present but only the
// active variant carries a value ({}). The other keys are undefined, so they
// must be checked by value, not with `in` (which is always true).
export function parseCampaignStatus(value: any): number {
  if (typeof value === "number" || typeof value === "bigint") return Number(value);
  const v = value?.variant;
  if (v && typeof v === "object") {
    if (v.Active !== undefined) return 0;
    if (v.Completed !== undefined) return 1;
    if (v.Cancelled !== undefined) return 2;
  }
  return Number(value);
}

// Same for the Cairo bool — it can come back as { variant: { True: {} } }.
export function parseCairoBool(value: any): boolean {
  if (typeof value === "boolean") return value;
  const v = value?.variant;
  if (v && typeof v === "object") return "True" in v;
  return Boolean(value);
}

// Domain separator for client-computed winner entitlements. Versioned so a
// future commitment scheme can be introduced without colliding with prior
// commitments: poseidon(DOMAIN, campaign_id, winner_address).
export const COMMIT_DOMAIN_V1 = "GAMESHIELD_COMMIT_V1";

// Winner entitlement commitment: poseidon(DOMAIN, campaign_id, winner_address).
// Computed client-side; only the hash ever reaches the registry and the helper,
// so the winner's address is never published on-chain. The domain separator
// binds the commitment to this dapp and prevents cross-protocol replay.
export function winnerCommitment(campaignId: number | bigint, winnerAddress: string): string {
  return num.toHex(
    hash.computePoseidonHashOnElements([
      COMMIT_DOMAIN_V1,
      num.toHex(campaignId),
      validateAddr(winnerAddress),
    ])
  );
}

export function validateAddr(addr: string): string {
  return num.toHex(num.toBigInt(addr));
}

export async function getCampaignCount(
  provider: ProviderInterface,
  registry: string
): Promise<number> {
  const c = await registryContract(provider, registry);
  const count = await c.get_campaign_count();
  return Number(count);
}

export async function getCampaign(
  provider: ProviderInterface,
  registry: string,
  id: number
): Promise<Campaign> {
  const c = await registryContract(provider, registry);
  const raw: any = await c.get_campaign(id);
  return {
    id,
    organizer: validateAddr(raw.organizer as string),
    // v1 contracts store no token; the STRK20 pool flow is STRK-only there.
    token: raw.token ? validateAddr(raw.token as string) : addrSTRK,
    rewardAmount: num.toBigInt(raw.reward_amount),
    deadline: num.toBigInt(raw.deadline),
    criteriaHash: num.toHex(raw.criteria_hash as string),
    status: parseCampaignStatus(raw.status),
    winnerCommitment: num.toHex(raw.winner_commitment as string),
    paid: parseCairoBool(raw.paid),
    title: raw.title ? num.toHex(raw.title as string) : "0x0",
  };
}
