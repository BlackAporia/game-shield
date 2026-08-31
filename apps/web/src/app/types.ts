// Shared UI types for the GameShield frontend.
//
// The Campaign shape mirrors the deployed public-payout contract: each
// winner slot stores a plain wallet address and claims are authorized by the
// connected account matching that address.

export type CampaignStatus = "active" | "resolved";

export type Campaign = {
  id: number;
  organizer: string;
  token: string; // ERC-20 address
  rewardAmount: bigint;
  deadline: bigint; // unix seconds
  criteriaHash: string;
  title: string; // on-chain felt252, decoded
  status: CampaignStatus;
  funded: boolean;
  winner: string; // "0x0" until assign_winner is called
  claimed: boolean;
  assignmentGracePeriod: bigint;
  claimExpiryWindow: bigint;
  totalAllocated: bigint;
  winnerSlotCount: number;
  unallocatedSwept: boolean;
  refundPool: bigint;
  winnerSlots: WinnerSlot[];
  description?: string;
};

export type WinnerSlot = {
  slotId: number;
  amount: bigint;
  winnerAddress: string;
  claimed: boolean;
  assignedAt: bigint;
};

export type ResultRow = { label: string; value: string; hash?: string; ok?: boolean };

export type ActionResult = {
  status: "pending" | "ok" | "error";
  title: string;
  rows?: ResultRow[];
  note?: string;
};

export function errorResult(msg: string): ActionResult {
  return { status: "error", title: "Action failed", note: msg };
}
