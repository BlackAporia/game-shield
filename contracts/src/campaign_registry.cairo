use starknet::{ContractAddress, get_caller_address};

#[derive(Copy, Drop, Serde, PartialEq, starknet::Store)]
pub enum CampaignStatus {
    Active,
    Completed,
    Cancelled,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Campaign {
    pub organizer: ContractAddress,
    pub reward_amount: u128,
    pub deadline: u64,
    pub criteria_hash: felt252,
    pub status: CampaignStatus,
    pub winner_commitment: felt252,
    pub paid: bool,
}

#[starknet::interface]
pub trait ICampaignRegistry<T> {
    fn create_campaign(
        ref self: T, reward_amount: u128, deadline: u64, criteria_hash: felt252,
    ) -> u64;
    fn complete_campaign(ref self: T, campaign_id: u64, winner_commitment: felt252);
    fn cancel_campaign(ref self: T, campaign_id: u64);
    fn set_helper(ref self: T, helper: ContractAddress);
    fn get_campaign(self: @T, campaign_id: u64) -> Campaign;
    fn get_campaign_count(self: @T) -> u64;
    fn is_payout_valid(
        self: @T, campaign_id: u64, winner_commitment: felt252, amount: u128,
    ) -> bool;
    fn mark_paid(ref self: T, campaign_id: u64);
}

mod errors {
    pub const ZERO_REWARD: felt252 = 'ZERO_REWARD';
    pub const ZERO_DEADLINE: felt252 = 'ZERO_DEADLINE';
    pub const NOT_FOUND: felt252 = 'NOT_FOUND';
    pub const NOT_ORGANIZER: felt252 = 'NOT_ORGANIZER';
    pub const NOT_HELPER: felt252 = 'NOT_HELPER';
    pub const NOT_ACTIVE: felt252 = 'NOT_ACTIVE';
    pub const NOT_COMPLETED: felt252 = 'NOT_COMPLETED';
    pub const ALREADY_PAID: felt252 = 'ALREADY_PAID';
    pub const WRONG_COMMITMENT: felt252 = 'WRONG_COMMITMENT';
    pub const WRONG_AMOUNT: felt252 = 'WRONG_AMOUNT';
}

#[starknet::contract]
pub mod CampaignRegistry {
    use core::num::traits::Zero;
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use super::{Campaign, CampaignStatus, ICampaignRegistry, errors};

    #[storage]
    struct Storage {
        owner: ContractAddress,
        helper: ContractAddress,
        campaigns: starknet::storage::Map<u64, Campaign>,
        campaign_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CampaignCreated: CampaignCreated,
        CampaignCompleted: CampaignCompleted,
        CampaignCancelled: CampaignCancelled,
        PayoutMarked: PayoutMarked,
    }

    #[derive(Drop, starknet::Event)]
    struct CampaignCreated {
        #[key]
        campaign_id: u64,
        organizer: ContractAddress,
        reward_amount: u128,
        deadline: u64,
        criteria_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct CampaignCompleted {
        #[key]
        campaign_id: u64,
        winner_commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct CampaignCancelled {
        #[key]
        campaign_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PayoutMarked {
        #[key]
        campaign_id: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl CampaignRegistryImpl of super::ICampaignRegistry<ContractState> {
        fn create_campaign(
            ref self: ContractState,
            reward_amount: u128,
            deadline: u64,
            criteria_hash: felt252,
        ) -> u64 {
            assert(reward_amount != 0, errors::ZERO_REWARD);
            assert(deadline != 0, errors::ZERO_DEADLINE);

            let campaign_id = self.campaign_count.read() + 1;
            self
                .campaigns
                .write(
                    campaign_id,
                    Campaign {
                        organizer: get_caller_address(),
                        reward_amount,
                        deadline,
                        criteria_hash,
                        status: CampaignStatus::Active,
                        winner_commitment: 0,
                        paid: false,
                    },
                );
            self.campaign_count.write(campaign_id);
            self
                .emit(
                    Event::CampaignCreated(
                        CampaignCreated {
                            campaign_id,
                            organizer: get_caller_address(),
                            reward_amount,
                            deadline,
                            criteria_hash,
                        },
                    ),
                );
            campaign_id
        }

        fn complete_campaign(
            ref self: ContractState, campaign_id: u64, winner_commitment: felt252,
        ) {
            let mut campaign = self.campaigns.read(campaign_id);
            assert(campaign.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(campaign.organizer == get_caller_address(), errors::NOT_ORGANIZER);
            assert(campaign.status == CampaignStatus::Active, errors::NOT_ACTIVE);
            assert(winner_commitment.is_non_zero(), errors::WRONG_COMMITMENT);

            campaign.status = CampaignStatus::Completed;
            campaign.winner_commitment = winner_commitment;
            self.campaigns.write(campaign_id, campaign);
            self.emit(Event::CampaignCompleted(CampaignCompleted { campaign_id, winner_commitment }));
        }

        fn cancel_campaign(ref self: ContractState, campaign_id: u64) {
            let mut campaign = self.campaigns.read(campaign_id);
            assert(campaign.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(campaign.organizer == get_caller_address(), errors::NOT_ORGANIZER);
            assert(campaign.status == CampaignStatus::Active, errors::NOT_ACTIVE);

            campaign.status = CampaignStatus::Cancelled;
            self.campaigns.write(campaign_id, campaign);
            self.emit(Event::CampaignCancelled(CampaignCancelled { campaign_id }));
        }

        fn set_helper(ref self: ContractState, helper: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_ORGANIZER);
            self.helper.write(helper);
        }

        fn get_campaign(self: @ContractState, campaign_id: u64) -> Campaign {
            self.campaigns.read(campaign_id)
        }

        fn get_campaign_count(self: @ContractState) -> u64 {
            self.campaign_count.read()
        }

        fn is_payout_valid(
            self: @ContractState, campaign_id: u64, winner_commitment: felt252, amount: u128,
        ) -> bool {
            let campaign = self.campaigns.read(campaign_id);
            campaign.status == CampaignStatus::Completed
                && !campaign.paid
                && campaign.winner_commitment == winner_commitment
                && campaign.reward_amount == amount
        }

        fn mark_paid(ref self: ContractState, campaign_id: u64) {
            assert(get_caller_address() == self.helper.read(), errors::NOT_HELPER);
            let mut campaign = self.campaigns.read(campaign_id);
            assert(campaign.organizer.is_non_zero(), errors::NOT_FOUND);
            assert(campaign.status == CampaignStatus::Completed, errors::NOT_COMPLETED);
            assert(!campaign.paid, errors::ALREADY_PAID);

            campaign.paid = true;
            self.campaigns.write(campaign_id, campaign);
            self.emit(Event::PayoutMarked(PayoutMarked { campaign_id }));
        }
    }
}