import { Abi, Contract, hash, num, ProviderInterface } from "starknet";
import registryAbi from "../contracts/CampaignRegistry.json";
import helperAbi from "../contracts/PayoutHelper.json";

// On-chain status of a campaign, matching CampaignStatus in campaign_registry.cairo.
export const CAMPAIGN_STATUS = ["Active", "Completed", "Cancelled"] as const;
export type CampaignStatusName = (typeof CAMPAIGN_STATUS)[number];

export type Campaign = {
  id: number;
  organizer: string;
  rewardAmount: bigint;
  deadline: bigint;
  criteriaHash: string;
  status: number;
  winnerCommitment: string;
  paid: boolean;
};

export function registryContract(provider: ProviderInterface, address: string): Contract {
  return new Contract({ abi: registryAbi as Abi, address, providerOrAccount: provider });
}

export function helperContract(provider: ProviderInterface, address: string): Contract {
  return new Contract({ abi: helperAbi as Abi, address, providerOrAccount: provider });
}

export function statusName(status: number): CampaignStatusName {
  return CAMPAIGN_STATUS[status] ?? "Active";
}

// Winner entitlement commitment: poseidon(campaign_id, winner_address). Computed
// client-side; only the hash ever reaches the registry and the helper, so the
// winner's address is never published on-chain.
export function winnerCommitment(campaignId: number | bigint, winnerAddress: string): string {
  return num.toHex(
    hash.computePoseidonHashOnElements([num.toHex(campaignId), validateAddr(winnerAddress)])
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
    rewardAmount: num.toBigInt(raw.reward_amount),
    deadline: num.toBigInt(raw.deadline),
    criteriaHash: num.toHex(raw.criteria_hash as string),
    status: Number(raw.status),
    winnerCommitment: num.toHex(raw.winner_commitment as string),
    paid: Boolean(raw.paid),
  };
}

// Parse the Funded / PayoutCommitted events of the payout helper from a receipt.
export type HelperEventInfo = {
  name: "Funded" | "PayoutCommitted";
  campaignId: number;
  amount: bigint;
  commitment?: string;
};

export function parseHelperEvents(receipt: any, helperAddress: string): HelperEventInfo[] {
  const events: any[] = receipt?.events ?? receipt?.value?.events ?? [];
  const out: HelperEventInfo[] = [];
  for (const e of events) {
    const from = num.toHex(e.from_address ?? "");
    if (from !== num.toHex(helperAddress)) continue;
    const key = num.toHex(e.keys?.[0] ?? "");
    const selFunded = num.toHex(hash.getSelectorFromName("Funded"));
    const selPayout = num.toHex(hash.getSelectorFromName("PayoutCommitted"));
    if (key === selFunded) {
      out.push({
        name: "Funded",
        campaignId: Number(num.toBigInt(e.keys?.[1])),
        amount: num.toBigInt(e.data?.[0]),
      });
    } else if (key === selPayout) {
      out.push({
        name: "PayoutCommitted",
        campaignId: Number(num.toBigInt(e.keys?.[1])),
        amount: num.toBigInt(e.data?.[1]),
        commitment: num.toHex(e.data?.[0]),
      });
    }
  }
  return out;
}

// ABI reference for the helper (kept for type parity with the Cairo interface).
export { helperAbi };
