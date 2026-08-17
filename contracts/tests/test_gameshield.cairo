use snforge_std::{
    CheatSpan, cheat_caller_address, declare, DeclareResultTrait, ContractClassTrait,
};
use starknet::ContractAddress;

use gameshield::campaign_registry::{
    ICampaignRegistryDispatcher, ICampaignRegistryDispatcherTrait, CampaignStatus,
};
use gameshield::payout_helper::{
    IPayoutHelperDispatcher, IPayoutHelperDispatcherTrait, Operation,
};
use gameshield::test_erc20::{ITestErc20Dispatcher, ITestErc20DispatcherTrait};

const ORGANIZER: felt252 = 'organizer';
const ALICE: felt252 = 'alice';
const POOL: felt252 = 'pool';
const CRITERIA: felt252 = 'criteria-v1';

fn addr(felt: felt252) -> ContractAddress {
    felt.try_into().unwrap()
}

// Applies the caller cheat to the NEXT single call against `target`.
// Scoped, so cross-contract calls made by the helper keep their real caller.
fn cheat_caller_for(target: ContractAddress, caller: felt252) {
    let one: u32 = 1;
    cheat_caller_address(target, addr(caller), CheatSpan::TargetCalls(one.try_into().unwrap()));
}

fn deploy_registry() -> ContractAddress {
    let class = declare("CampaignRegistry").unwrap().contract_class();
    let (address, _) = class.deploy(@array![addr(ORGANIZER).into()]).unwrap();
    address
}

fn deploy_helper(registry: ContractAddress) -> ContractAddress {
    let class = declare("PayoutHelper").unwrap().contract_class();
    let (address, _) = class.deploy(@array![addr(POOL).into(), registry.into()]).unwrap();

    // Wire the helper into the registry (owner-only).
    cheat_caller_for(registry, ORGANIZER);
    ICampaignRegistryDispatcher { contract_address: registry }.set_helper(address);
    address
}

fn deploy_erc20() -> ContractAddress {
    let class = declare("TestErc20").unwrap().contract_class();
    let (address, _) = class.deploy(@array![]).unwrap();
    address
}

fn mint(token: ContractAddress, account: ContractAddress, amount: u128) {
    ITestErc20Dispatcher { contract_address: token }.mint(account, u256 { low: amount, high: 0 });
}

fn create_campaign(registry: ContractAddress, reward: u128, deadline: u64) -> u64 {
    cheat_caller_for(registry, ORGANIZER);
    ICampaignRegistryDispatcher { contract_address: registry }
        .create_campaign(reward, deadline, CRITERIA)
}

fn complete_campaign(registry: ContractAddress, id: u64, commitment: felt252) {
    cheat_caller_for(registry, ORGANIZER);
    ICampaignRegistryDispatcher { contract_address: registry }.complete_campaign(id, commitment);
}

fn invoke_as_pool(helper: ContractAddress, op: Operation, id: u64, token: ContractAddress, amount: u128, commitment: felt252, note_id: felt252) -> Span<gameshield::payout_helper::OpenNoteDeposit> {
    cheat_caller_for(helper, POOL);
    IPayoutHelperDispatcher { contract_address: helper }
        .privacy_invoke(op, id, token, amount, commitment, note_id)
}

#[test]
fn create_campaign_sets_state() {
    let registry = deploy_registry();
    let dispatcher = ICampaignRegistryDispatcher { contract_address: registry };

    let id = create_campaign(registry, 1000, 100);
    assert!(id == 1, "first campaign id must be 1");

    let campaign = dispatcher.get_campaign(id);
    assert!(campaign.organizer == addr(ORGANIZER), "organizer mismatch");
    assert!(campaign.reward_amount == 1000, "reward mismatch");
    assert!(campaign.status == CampaignStatus::Active, "status must be Active");
}

#[test]
#[should_panic(expected: ('ZERO_REWARD',))]
fn zero_reward_rejected() {
    let registry = deploy_registry();
    cheat_caller_for(registry, ORGANIZER);
    ICampaignRegistryDispatcher { contract_address: registry }
        .create_campaign(0, 100, CRITERIA);
}

#[test]
fn complete_and_validate_payout() {
    let registry = deploy_registry();
    let dispatcher = ICampaignRegistryDispatcher { contract_address: registry };

    let id = create_campaign(registry, 1000, 100);
    let commitment: felt252 = 0x1234;
    complete_campaign(registry, id, commitment);

    let campaign = dispatcher.get_campaign(id);
    assert!(campaign.winner_commitment == commitment, "commitment stored");
    assert!(dispatcher.is_payout_valid(id, commitment, 1000), "payout must be valid");
    assert!(!dispatcher.is_payout_valid(id, 0x9999, 1000), "wrong commitment rejected");
    assert!(!dispatcher.is_payout_valid(id, commitment, 500), "wrong amount rejected");
}

#[test]
#[should_panic(expected: ('NOT_ORGANIZER',))]
fn only_organizer_completes() {
    let registry = deploy_registry();
    let id = create_campaign(registry, 1000, 100);

    cheat_caller_for(registry, ALICE);
    ICampaignRegistryDispatcher { contract_address: registry }.complete_campaign(id, 0x1234);
}

#[test]
#[should_panic(expected: ('NOT_HELPER',))]
fn mark_paid_only_by_helper() {
    let registry = deploy_registry();
    let helper = deploy_helper(registry);
    let id = create_campaign(registry, 1000, 100);
    complete_campaign(registry, id, 0x1234);

    cheat_caller_for(registry, ALICE);
    ICampaignRegistryDispatcher { contract_address: registry }.mark_paid(id);
    let _ = helper;
}

#[test]
fn fund_flow_returns_open_note() {
    let registry = deploy_registry();
    let helper = deploy_helper(registry);
    let token = deploy_erc20();

    let id = create_campaign(registry, 1000, 100);
    mint(token, helper, 1000);

    let deposits = invoke_as_pool(helper, Operation::Fund, id, token, 1000, 0, 0x1111);

    assert!(deposits.len() == 1, "one open note");
    assert!(*deposits[0].note_id == 0x1111, "note id passthrough");
    assert!(*deposits[0].amount == 1000, "amount passthrough");

    let helper_dispatcher = IPayoutHelperDispatcher { contract_address: helper };
    assert!(helper_dispatcher.get_funded(id) == 1000, "funded recorded");
}

#[test]
#[should_panic(expected: ('CALLER_NOT_POOL',))]
fn only_pool_can_invoke() {
    let registry = deploy_registry();
    let helper = deploy_helper(registry);
    let token = deploy_erc20();

    let id = create_campaign(registry, 1000, 100);
    mint(token, helper, 1000);

    cheat_caller_for(helper, ALICE);
    IPayoutHelperDispatcher { contract_address: helper }
        .privacy_invoke(Operation::Fund, id, token, 1000, 0, 0x1111);
}

#[test]
fn payout_flow_marks_paid() {
    let registry = deploy_registry();
    let helper = deploy_helper(registry);
    let token = deploy_erc20();

    let dispatcher = ICampaignRegistryDispatcher { contract_address: registry };
    let id = create_campaign(registry, 1000, 100);
    let commitment: felt252 = 0x4242;
    complete_campaign(registry, id, commitment);

    mint(token, helper, 1000);
    let deposits = invoke_as_pool(
        helper, Operation::Payout, id, token, 1000, commitment, 0x2222,
    );

    assert!(deposits.len() == 1, "one open note");
    assert!(*deposits[0].note_id == 0x2222, "note id passthrough");
    assert!(*deposits[0].amount == 1000, "amount passthrough");

    let helper_dispatcher = IPayoutHelperDispatcher { contract_address: helper };
    assert!(helper_dispatcher.get_payout_count() == 1, "payout counted");

    let campaign = dispatcher.get_campaign(id);
    assert!(campaign.paid, "payout marked in registry");
}

#[test]
#[should_panic(expected: ('PAYOUT_INVALID',))]
fn double_payout_rejected() {
    let registry = deploy_registry();
    let helper = deploy_helper(registry);
    let token = deploy_erc20();

    let id = create_campaign(registry, 1000, 100);
    let commitment: felt252 = 0x4242;
    complete_campaign(registry, id, commitment);

    mint(token, helper, 1000);
    let _ = invoke_as_pool(helper, Operation::Payout, id, token, 1000, commitment, 0x1);

    // Pool pulls the paid amount, then a second payout attempt arrives.
    cheat_caller_for(token, POOL);
    ITestErc20Dispatcher { contract_address: token }
        .transfer_from(helper, addr(POOL), u256 { low: 1000, high: 0 });
    mint(token, helper, 1000);
    let _ = invoke_as_pool(helper, Operation::Payout, id, token, 1000, commitment, 0x2);
}

#[test]
#[should_panic(expected: ('CAMPAIGN_NOT_ACTIVE',))]
fn cannot_fund_cancelled_campaign() {
    let registry = deploy_registry();
    let helper = deploy_helper(registry);
    let token = deploy_erc20();

    let id = create_campaign(registry, 1000, 100);
    cheat_caller_for(registry, ORGANIZER);
    ICampaignRegistryDispatcher { contract_address: registry }.cancel_campaign(id);

    mint(token, helper, 1000);
    let _ = invoke_as_pool(helper, Operation::Fund, id, token, 1000, 0, 0x1111);
}