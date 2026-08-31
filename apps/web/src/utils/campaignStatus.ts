import type { Campaign } from "../app/types";

export type DerivedCampaignStatus = "Draft" | "Active" | "Closed";

export function deriveCampaignStatus(campaign: Campaign, now = BigInt(Math.floor(Date.now() / 1000))): DerivedCampaignStatus {
  if (!campaign.funded) return "Draft";
  const graceExpired = now > campaign.deadline + campaign.assignmentGracePeriod;
  const allocationClosed = campaign.unallocatedSwept || campaign.totalAllocated === campaign.rewardAmount;
  return graceExpired && allocationClosed ? "Closed" : "Active";
}
