// SPDX-License-Identifier: MIT
//
// GameShield — one contract owning the full bounty lifecycle, supporting
// MULTIPLE independently-sized winners per campaign, with fully automatic,
// permissionless refund paths and NO admin/dispute role of any kind.
//
// CHANGELOG — public-payout redesign (replaces the commit-reveal claim flow):
//
//  THE PROBLEM THIS FIXES: the previous version paid winners through
//  privacy_invoke's CommitClaim/RevealClaim, so a claimant could stay
//  anonymous even at payout. That required a secret, submitted in plain
//  calldata at RevealClaim time. Starknet calldata is visible before a
//  transaction confirms (mempool/sequencer/relayer can all see it), so
//  anyone watching a pending RevealClaim could, in principle, read the
//  secret and race a competing claim. The commit-reveal step was built
//  specifically to close that race (see the file's prior header, kept
//  below for context on why commit-reveal existed) — but after review,
//  the exposure it was patching only exists BECAUSE the payout
//  destination (note_id) was still decided by whoever submitted the
//  reveal. Removing that degree of freedom removes the race entirely,
//  and is simpler than patching around it.
//
//  THE FIX: winner and refund destinations are no longer secrets at all.
//  `add_winner` now takes the winner's real wallet address directly —
//  the organizer already has it, they're picking from a list of
//  applicants. A slot's payout can only ever go to that exact address,
//  fixed the moment the organizer assigns it, long before any claim
//  transaction exists. There is nothing left for a bystander to steal:
//  copying a pending claim transaction gains an attacker nothing, since
//  the destination was never something the claim transaction could set.
//  Refunds pay back to the campaign's own `organizer` field, which
//  already existed and needs no separate commitment either.
//
//  WHAT THIS COSTS: winner identity is now visible on-chain from the
//  moment they're assigned, not just at claim time. Funding privacy and
//  winner-selection privacy (nobody can predict a slot's destination
//  before the organizer assigns it) are unaffected — this narrows the
//  privacy window at the very end of the flow, it doesn't remove it.
//  Documented as a deliberate, disclosed tradeoff — see project README.
//
//  WHAT THIS REMOVES: the entire CommitClaim/RevealClaim two-step, the
//  claim_commitments map, compute_claim_commit/compute_winner_hash/
//  compute_refund_hash, the WINNER_TAG/REFUND_TAG/CLAIM_COMMIT_TAG
//  constants, and `refund_commitment` from Campaign (refund destination
//  is just `organizer`, already stored). Claims are no longer routed
//  through `privacy_invoke` at all — `privacy_invoke` now only ever
//  funds a campaign (Deposit). Payout is a plain, direct ERC20
//  `transfer` this contract makes itself, since it already holds
//  custody of the funds from the Deposit step.
//
// Design (unchanged from prior version, still true):
//  - THE CORE PRINCIPLE THIS VERSION IS BUILT AROUND: money should never
//    be permanently stuck, and no human — not the organizer, not this
//    project's own team — should have a special "release the funds"
//    button. Every path that returns money to the organizer is a plain
//    timeout check anyone can trigger.
//
//  - A campaign is funded ONCE, for a single total pot (`reward_amount`).
//    The organizer decides the split of that pot by calling `add_winner`
//    as many times as they like — each call carves out one independent
//    winner slot with its own `amount` and its own `winner_address`.
//
//  - TWO INDEPENDENT AUTOMATIC REFUND PATHS, both organizer-configurable
//    per campaign at creation, both feeding the same `refund_pool`
//    accumulator, both unchanged in mechanics from the prior version:
//
//    1. sweep_unallocated — leftover, never-assigned funds after
//       `assignment_grace_period` past `deadline`. Permissionless.
//    2. sweep_expired_slot — a specific assigned winner who never
//       claimed within `claim_expiry_window` of being assigned.
//       Permissionless, independent per slot.
//
//    Both sweeps remain pure bookkeeping (no ERC20 transfer at sweep
//    time) — the actual token movement only happens when `refund_pool`
//    is drained via `claim_refund`, which pays the organizer directly.
//
//  - NO MINIMUM TIMEOUT FLOOR (DELIBERATE, HACKATHON-SCOPE DECISION):
//    unchanged from before — see NO MINIMUM TIMEOUT FLOOR note. UI must
//    surface both windows clearly.
//
//  - No on-chain game verification, by design — unchanged.
//
//  - SOLVENCY INVARIANT: `total_escrowed[token]` unchanged in spirit —
//    now decremented on both `claim_winner` and `claim_refund` (the two
//    places tokens actually leave this contract), instead of only on
//    RevealClaim.
//
//  - ALLOCATION INVARIANT: unchanged — `total_allocated` per campaign
//    still tracks the running sum of every winner slot's amount.
//
//  - STATUS: rewritten for the public-payout design and compiles
//    cleanly with `scarb build`. Needs a fresh snforge suite — the old
//    tests covered the commit-reveal claim path, which no longer
//    exists. NOT externally audited.

use starknet::ContractAddress;

// ---------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------

// Mirrors the pool's expected return type from `privacy_invoke`. Still
// needed because `privacy_invoke` still exists (for Deposit) and the
// pool deserializes its return as this type — every branch now just
// returns an empty span, since nothing credits an open note anymore.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

// Sentinel slot_id meaning "the refund pool," used only in the
// RewardClaimed event now (claim_refund is its own function, no longer
// routed through a shared claim entry point that needs a sentinel to
// disambiguate). Kept for event-log continuity with the prior design.
pub const REFUND_SLOT_ID: u32 = 0xFFFFFFFF;

// ---------------------------------------------------------------------
// Campaign + winner-slot state
// ---------------------------------------------------------------------

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Campaign {
    pub organizer: ContractAddress,
    pub token: ContractAddress,
    pub reward_amount: u128, // total pot, fixed at creation, funded once
    pub deadline: u64,
    pub criteria_hash: felt252,
    pub title: felt252,
    pub funded: bool,
    pub assignment_grace_period: u64, // seconds after `deadline` before unallocated funds sweep
    pub claim_expiry_window: u64, // seconds after a slot is assigned before it can be swept
    pub total_allocated: u128,
    pub winner_slot_count: u32,
    pub unallocated_swept: bool, // true once the post-grace-period leftover sweep has run
    pub refund_pool: u128, // accumulated via sweeps; drained by claim_refund, paid to organizer
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct WinnerSlot {
    pub amount: u128,
    pub winner_address: ContractAddress, // zero() means "slot does not exist"
    pub claimed: bool, // also set true by sweep_expired_slot
    pub assigned_at: u64,
}

pub mod errors {
    pub const ZERO_REWARD: felt252 = 'ZERO_REWARD';
    pub const ZERO_DEADLINE: felt252 = 'ZERO_DEADLINE';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const EMPTY_TITLE: felt252 = 'EMPTY_TITLE';
    pub const DEADLINE_PASSED: felt252 = 'DEADLINE_PASSED';
    pub const NOT_FOUND: felt252 = 'NOT_FOUND';
    pub const NOT_ORGANIZER: felt252 = 'NOT_ORGANIZER';
    pub const ZERO_WINNER_ADDRESS: felt252 = 'ZERO_WINNER_ADDRESS';
    pub const ZERO_WINNER_AMOUNT: felt252 = 'ZERO_WINNER_AMOUNT';
    pub const OVER_ALLOCATED: felt252 = 'OVER_ALLOCATED';
    pub const UNALLOCATED_ALREADY_SWEPT: felt252 = 'UNALLOCATED_ALREADY_SWEPT';
    pub const NOT_YET_SWEEPABLE: felt252 = 'NOT_YET_SWEEPABLE';
    pub const NOTHING_TO_SWEEP: felt252 = 'NOTHING_TO_SWEEP';
    pub const NOTHING_TO_REFUND: felt252 = 'NOTHING_TO_REFUND';
    pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
    pub const ALREADY_FUNDED: felt252 = 'ALREADY_FUNDED';
    pub const TOKEN_MISMATCH: felt252 = 'TOKEN_MISMATCH';
    pub const AMOUNT_MISMATCH: felt252 = 'AMOUNT_MISMATCH';
    pub const NOT_FUNDED: felt252 = 'NOT_FUNDED';
    pub const SLOT_NOT_FOUND: felt252 = 'SLOT_NOT_FOUND';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const NOT_WINNER: felt252 = 'NOT_WINNER';
    pub const INSOLVENT: felt252 = 'INSOLVENT';
}

// ---------------------------------------------------------------------
// Minimal ERC20 interface. `transfer` replaces the old `approve` — this
// contract now pays winners/refunds directly instead of routing payout
// through the pool, so it needs to move tokens itself, not authorize
// the pool to pull them.
// ---------------------------------------------------------------------

#[starknet::interface]
pub trait IERC20<T> {
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
}

// ---------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------

#[starknet::interface]
pub trait IGameShield<T> {
    // `assignment_grace_period` and `claim_expiry_window` are both
    // organizer-set durations (seconds), unrestricted including 0 — see
    // NO MINIMUM TIMEOUT FLOOR in the file header.
    fn create_campaign(
        ref self: T,
        token: ContractAddress,
        reward_amount: u128,
        deadline: u64,
        criteria_hash: felt252,
        title: felt252,
        assignment_grace_period: u64,
        claim_expiry_window: u64,
    ) -> u64;

    // Organizer-only. Carves out ONE new winner slot from the campaign's
    // pot, worth `amount`, payable ONLY to `winner_address`. Callable
    // repeatedly as long as the campaign is funded, the
    // unallocated-sweep hasn't fired yet, and the running total of all
    // slot amounts (including this one) doesn't exceed the funded pot.
    // Returns the new slot's id.
    fn add_winner(ref self: T, campaign_id: u64, amount: u128, winner_address: ContractAddress) -> u32;

    // Called by the connected wallet of whoever is claiming. Reverts
    // unless the caller's own address matches the slot's
    // `winner_address` exactly — this is the entire authorization check,
    // no secret involved. Pays out via a direct, plain ERC20 transfer to
    // the caller.
    fn claim_winner(ref self: T, campaign_id: u64, slot_id: u32);

    // Organizer-only. Drains whatever's currently in `refund_pool` and
    // pays it to `campaign.organizer` directly. Callable more than once
    // over a campaign's life, same as before — each call pays out
    // whatever has accumulated since the last drain.
    fn claim_refund(ref self: T, campaign_id: u64);

    // Fully permissionless — anyone can call this, no organizer check.
    // Unchanged from prior version.
    fn sweep_unallocated(ref self: T, campaign_id: u64);

    // Fully permissionless, same safety reasoning as sweep_unallocated.
    // Unchanged from prior version.
    fn sweep_expired_slot(ref self: T, campaign_id: u64, slot_id: u32);

    fn get_campaign(self: @T, campaign_id: u64) -> Campaign;

    fn get_campaign_count(self: @T) -> u64;

    fn get_winner_slot(self: @T, campaign_id: u64, slot_id: u32) -> WinnerSlot;

    // Called by the STRK20 pool via INVOKE_SELECTOR — never call this
    // directly. Only ever funds a campaign now; claims no longer route
    // through the pool at all.
    fn privacy_invoke(
        ref self: T,
        campaign_id: u64,
        token: ContractAddress,
        amount: u128,
    ) -> Span<OpenNoteDeposit>;
}

// ---------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------

#[starknet::contract]
pub mod GameShield {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{
        Campaign, IERC20Dispatcher, IERC20DispatcherTrait, IGameShield, OpenNoteDeposit,
        REFUND_SLOT_ID, WinnerSlot, errors,
    };

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress, // TODO: set to the live STRK20 pool address
        campaign_counter: u64,
        campaigns: Map<u64, Campaign>,
        winner_slots: Map<(u64, u32), WinnerSlot>,
        // Sum of reward_amount across every campaign in this token this
        // contract is on the hook for. See file header SOLVENCY INVARIANT.
        total_escrowed: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        CampaignCreated: CampaignCreated,
        CampaignFunded: CampaignFunded,
        WinnerAdded: WinnerAdded,
        UnallocatedSwept: UnallocatedSwept,
        SlotExpiredSwept: SlotExpiredSwept,
        RewardClaimed: RewardClaimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CampaignCreated {
        #[key]
        pub campaign_id: u64,
        pub organizer: ContractAddress,
        pub token: ContractAddress,
        pub reward_amount: u128,
        pub deadline: u64,
        pub criteria_hash: felt252,
        pub title: felt252,
        pub assignment_grace_period: u64,
        pub claim_expiry_window: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CampaignFunded {
        #[key]
        pub campaign_id: u64,
        pub reward_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WinnerAdded {
        #[key]
        pub campaign_id: u64,
        #[key]
        pub slot_id: u32,
        pub amount: u128,
        pub winner_address: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UnallocatedSwept {
        #[key]
        pub campaign_id: u64,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SlotExpiredSwept {
        #[key]
        pub campaign_id: u64,
        #[key]
        pub slot_id: u32,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardClaimed {
        #[key]
        pub campaign_id: u64,
        #[key]
        pub slot_id: u32,
        pub amount: u128,
        pub was_refund: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_pool: ContractAddress) {
        assert(privacy_pool.is_non_zero(), errors::CALLER_NOT_POOL);
        self.privacy_pool.write(privacy_pool);
        self.campaign_counter.write(0);
    }

    #[abi(embed_v0)]
    pub impl GameShieldImpl of IGameShield<ContractState> {
        fn create_campaign(
            ref self: ContractState,
            token: ContractAddress,
            reward_amount: u128,
            deadline: u64,
            criteria_hash: felt252,
            title: felt252,
            assignment_grace_period: u64,
            claim_expiry_window: u64,
        ) -> u64 {
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            assert(reward_amount != 0, errors::ZERO_REWARD);
            assert(deadline != 0, errors::ZERO_DEADLINE);
            assert(title.is_non_zero(), errors::EMPTY_TITLE);
            assert(get_block_timestamp() < deadline, errors::DEADLINE_PASSED);
            // No floor enforced on assignment_grace_period / claim_expiry_window —
            // see NO MINIMUM TIMEOUT FLOOR in the file header.

            let caller = get_caller_address();
            let campaign_id = self.campaign_counter.read() + 1;
            self.campaign_counter.write(campaign_id);

            let entry = Campaign {
                organizer: caller,
                token,
                reward_amount,
                deadline,
                criteria_hash,
                title,
                funded: false,
                assignment_grace_period,
                claim_expiry_window,
                total_allocated: 0,
                winner_slot_count: 0,
                unallocated_swept: false,
                refund_pool: 0,
            };
            self.campaigns.write(campaign_id, entry);

            self.emit(
                CampaignCreated {
                    campaign_id,
                    organizer: caller,
                    token,
                    reward_amount,
                    deadline,
                    criteria_hash,
                    title,
                    assignment_grace_period,
                    claim_expiry_window,
                },
            );

            // Actual funds move via a separate privacy_invoke(...) call
            // from the pool, bundled by the frontend in the same
            // multicall as this create_campaign call.
            campaign_id
        }

        fn add_winner(
            ref self: ContractState, campaign_id: u64, amount: u128, winner_address: ContractAddress,
        ) -> u32 {
            let caller = get_caller_address();
            let mut entry = self.campaigns.read(campaign_id);
            assert(entry.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(caller == entry.organizer, errors::NOT_ORGANIZER);
            assert(entry.funded, errors::NOT_FUNDED);
            assert(!entry.unallocated_swept, errors::UNALLOCATED_ALREADY_SWEPT);
            assert(amount != 0, errors::ZERO_WINNER_AMOUNT);
            assert(winner_address.is_non_zero(), errors::ZERO_WINNER_ADDRESS);

            let new_total_allocated = entry.total_allocated + amount;
            assert(new_total_allocated <= entry.reward_amount, errors::OVER_ALLOCATED);

            let slot_id = entry.winner_slot_count;
            self
                .winner_slots
                .write(
                    (campaign_id, slot_id),
                    WinnerSlot {
                        amount, winner_address, claimed: false, assigned_at: get_block_timestamp(),
                    },
                );

            entry.winner_slot_count = slot_id + 1;
            entry.total_allocated = new_total_allocated;
            self.campaigns.write(campaign_id, entry);

            self.emit(WinnerAdded { campaign_id, slot_id, amount, winner_address });

            slot_id
        }

        fn claim_winner(ref self: ContractState, campaign_id: u64, slot_id: u32) {
            let caller = get_caller_address();
            let entry = self.campaigns.read(campaign_id);
            assert(entry.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(entry.funded, errors::NOT_FUNDED);

            let mut slot = self.winner_slots.read((campaign_id, slot_id));
            assert(slot.winner_address.is_non_zero(), errors::SLOT_NOT_FOUND);
            assert(!slot.claimed, errors::ALREADY_CLAIMED);
            // The entire authorization check. No secret, no hash — the
            // destination was fixed back in add_winner, long before this
            // call could exist, so there is nothing here for anyone
            // watching the mempool to redirect.
            assert(caller == slot.winner_address, errors::NOT_WINNER);

            slot.claimed = true;
            self.winner_slots.write((campaign_id, slot_id), slot);

            let current_total = self.total_escrowed.read(entry.token);
            self.total_escrowed.write(entry.token, current_total - slot.amount);

            IERC20Dispatcher { contract_address: entry.token }
                .transfer(caller, slot.amount.into());

            self.emit(
                RewardClaimed { campaign_id, slot_id, amount: slot.amount, was_refund: false },
            );
        }

        fn claim_refund(ref self: ContractState, campaign_id: u64) {
            let caller = get_caller_address();
            let mut entry = self.campaigns.read(campaign_id);
            assert(entry.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(caller == entry.organizer, errors::NOT_ORGANIZER);
            assert(entry.refund_pool != 0, errors::NOTHING_TO_REFUND);

            let drained = entry.refund_pool;
            entry.refund_pool = 0;
            self.campaigns.write(campaign_id, entry);

            let current_total = self.total_escrowed.read(entry.token);
            self.total_escrowed.write(entry.token, current_total - drained);

            IERC20Dispatcher { contract_address: entry.token }.transfer(caller, drained.into());

            self.emit(
                RewardClaimed {
                    campaign_id, slot_id: REFUND_SLOT_ID, amount: drained, was_refund: true,
                },
            );
        }

        fn sweep_unallocated(ref self: ContractState, campaign_id: u64) {
            let mut entry = self.campaigns.read(campaign_id);
            assert(entry.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(entry.funded, errors::NOT_FUNDED);
            assert(!entry.unallocated_swept, errors::UNALLOCATED_ALREADY_SWEPT);
            assert(
                get_block_timestamp() > entry.deadline + entry.assignment_grace_period,
                errors::NOT_YET_SWEEPABLE,
            );

            let leftover = entry.reward_amount - entry.total_allocated;
            assert(leftover != 0, errors::NOTHING_TO_SWEEP);

            entry.unallocated_swept = true;
            entry.refund_pool = entry.refund_pool + leftover;
            self.campaigns.write(campaign_id, entry);

            self.emit(UnallocatedSwept { campaign_id, amount: leftover });
        }

        fn sweep_expired_slot(ref self: ContractState, campaign_id: u64, slot_id: u32) {
            let mut entry = self.campaigns.read(campaign_id);
            assert(entry.organizer.is_non_zero(), errors::NOT_FOUND);

            let mut slot = self.winner_slots.read((campaign_id, slot_id));
            assert(slot.winner_address.is_non_zero(), errors::SLOT_NOT_FOUND);
            assert(!slot.claimed, errors::ALREADY_CLAIMED);
            assert(
                get_block_timestamp() > slot.assigned_at + entry.claim_expiry_window,
                errors::NOT_YET_SWEEPABLE,
            );

            slot.claimed = true;
            self.winner_slots.write((campaign_id, slot_id), slot);

            entry.refund_pool = entry.refund_pool + slot.amount;
            self.campaigns.write(campaign_id, entry);

            self.emit(SlotExpiredSwept { campaign_id, slot_id, amount: slot.amount });
        }

        fn get_campaign(self: @ContractState, campaign_id: u64) -> Campaign {
            self.campaigns.read(campaign_id)
        }

        fn get_campaign_count(self: @ContractState) -> u64 {
            self.campaign_counter.read()
        }

        fn get_winner_slot(self: @ContractState, campaign_id: u64, slot_id: u32) -> WinnerSlot {
            self.winner_slots.read((campaign_id, slot_id))
        }

        fn privacy_invoke(
            ref self: ContractState, campaign_id: u64, token: ContractAddress, amount: u128,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.privacy_pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_POOL);

            let mut entry = self.campaigns.read(campaign_id);
            assert(entry.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(!entry.funded, errors::ALREADY_FUNDED);
            assert(token == entry.token, errors::TOKEN_MISMATCH);
            assert(amount == entry.reward_amount, errors::AMOUNT_MISMATCH);

            entry.funded = true;
            self.campaigns.write(campaign_id, entry);

            let new_total = self.total_escrowed.read(token) + amount;
            let actual_balance: u256 = IERC20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            assert(actual_balance >= new_total.into(), errors::INSOLVENT);
            self.total_escrowed.write(token, new_total);

            self.emit(CampaignFunded { campaign_id, reward_amount: entry.reward_amount });

            // Nothing credits an open note anymore — the pool still
            // expects this return type per the anonymizer-contract spec,
            // but it's always empty now.
            [].span()
        }
    }
}