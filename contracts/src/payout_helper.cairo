use starknet::{ContractAddress, get_caller_address, get_contract_address};

// Must match privacy::objects::OpenNoteDeposit (positional Serde).
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum Operation {
    Fund,
    Payout,
}

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IPayoutHelper<T> {
    // Called by the privacy pool via selector!("privacy_invoke").
    // Calldata order from the dapp must match this parameter list:
    // [operation, campaign_id, token, amount, commitment, "${openNoteIds[0]}"].
    fn privacy_invoke(
        ref self: T,
        operation: Operation,
        campaign_id: u64,
        token: ContractAddress,
        amount: u128,
        commitment: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn get_funded(self: @T, campaign_id: u64) -> u128;
    fn get_payout_count(self: @T) -> u64;
}

mod errors {
    pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const AMOUNT_MISMATCH: felt252 = 'AMOUNT_MISMATCH';
    pub const CAMPAIGN_NOT_FOUND: felt252 = 'CAMPAIGN_NOT_FOUND';
    pub const CAMPAIGN_NOT_ACTIVE: felt252 = 'CAMPAIGN_NOT_ACTIVE';
    pub const PAYOUT_INVALID: felt252 = 'PAYOUT_INVALID';
}

#[starknet::contract]
pub mod PayoutHelper {
    use core::num::traits::Zero;
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        IErc20Dispatcher, IErc20DispatcherTrait, OpenNoteDeposit, Operation, errors,
    };
    use crate::campaign_registry::{
        ICampaignRegistryDispatcher, ICampaignRegistryDispatcherTrait, CampaignStatus,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
        registry: ContractAddress,
        funded: starknet::storage::Map<u64, u128>,
        payout_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Funded: Funded,
        PayoutCommitted: PayoutCommitted,
    }

    #[derive(Drop, starknet::Event)]
    struct Funded {
        #[key]
        campaign_id: u64,
        amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct PayoutCommitted {
        #[key]
        campaign_id: u64,
        winner_commitment: felt252,
        amount: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress, registry: ContractAddress) {
        self.pool.write(pool);
        self.registry.write(registry);
    }

    #[abi(embed_v0)]
    impl PayoutHelperImpl of super::IPayoutHelper<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: Operation,
            campaign_id: u64,
            token: ContractAddress,
            amount: u128,
            commitment: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_POOL);
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            assert(amount != 0, errors::ZERO_AMOUNT);

            let erc20 = IErc20Dispatcher { contract_address: token };
            let balance: u128 = erc20.balance_of(get_contract_address()).try_into().unwrap();
            assert(balance == amount, errors::AMOUNT_MISMATCH);

            match operation {
                Operation::Fund => {
                    // Campaign must exist and be open for funding.
                    let campaign = ICampaignRegistryDispatcher {
                        contract_address: self.registry.read()
                    }.get_campaign(campaign_id);
                    assert(campaign.organizer.is_non_zero(), errors::CAMPAIGN_NOT_FOUND);
                    assert(
                        campaign.status == CampaignStatus::Active,
                        errors::CAMPAIGN_NOT_ACTIVE,
                    );

                    let funded = self.funded.read(campaign_id) + amount;
                    self.funded.write(campaign_id, funded);

                    // Pass the funds back to the organizer's open note — no custody.
                    erc20.approve(spender: pool, amount: amount.into());
                    self.emit(Event::Funded(Funded { campaign_id, amount }));
                    array![OpenNoteDeposit { note_id, token, amount }].span()
                },
                Operation::Payout => {
                    // Entitlement check lives in the registry; commitment is a hash,
                    // so no plaintext winner is ever published on-chain.
                    let registry = ICampaignRegistryDispatcher {
                        contract_address: self.registry.read()
                    };
                    assert(
                        registry.is_payout_valid(campaign_id, commitment, amount),
                        errors::PAYOUT_INVALID,
                    );

                    registry.mark_paid(campaign_id);
                    erc20.approve(spender: pool, amount: amount.into());
                    self.payout_count.write(self.payout_count.read() + 1);
                    self
                        .emit(
                            Event::PayoutCommitted(
                                PayoutCommitted { campaign_id, winner_commitment: commitment, amount },
                            ),
                        );
                    array![OpenNoteDeposit { note_id, token, amount }].span()
                },
            }
        }

        fn get_funded(self: @ContractState, campaign_id: u64) -> u128 {
            self.funded.read(campaign_id)
        }

        fn get_payout_count(self: @ContractState) -> u64 {
            self.payout_count.read()
        }
    }
}