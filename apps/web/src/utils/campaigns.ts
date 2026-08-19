import { Abi, Contract, hash, num, ProviderInterface } from "starknet";
import registryAbi from "../contracts/CampaignRegistry.json";

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

export function registryContract(provider: ProviderInterface, address: string): Contract {
  return new Contract({ abi: registryAbi as Abi, address, providerOrAccount: provider });
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
  const c = registryContract(provider, registry);
  const count = await c.get_campaign_count();
  return Number(count);
}

export async function getCampaign(
  provider: ProviderInterface,
  registry: string,
  id: number
): Promise<Campaign> {
  const c = registryContract(provider, registry);
  const raw: any = await c.get_campaign(id);
  return {
    id,
    organizer: validateAddr(raw.organizer as string),
    token: validateAddr(raw.token as string),
    rewardAmount: num.toBigInt(raw.reward_amount),
    deadline: num.toBigInt(raw.deadline),
    criteriaHash: num.toHex(raw.criteria_hash as string),
    status: parseCampaignStatus(raw.status),
    winnerCommitment: num.toHex(raw.winner_commitment as string),
    paid: parseCairoBool(raw.paid),
    title: num.toHex(raw.title as string),
  };
}
