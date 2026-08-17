use starknet::ContractAddress;

#[starknet::interface]
pub trait ITestErc20<T> {
    fn mint(ref self: T, account: ContractAddress, amount: u256);
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::contract]
pub mod TestErc20 {
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: starknet::storage::Map<ContractAddress, u256>,
        allowances: starknet::storage::Map<(ContractAddress, ContractAddress), u256>,
        total_supply: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    struct Transfer {
        #[key]
        from: ContractAddress,
        #[key]
        to: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        #[key]
        owner: ContractAddress,
        #[key]
        spender: ContractAddress,
        value: u256,
    }

    #[abi(embed_v0)]
    impl TestErc20Impl of super::ITestErc20<ContractState> {
        fn mint(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.write(account, self.balances.read(account) + amount);
            self.total_supply.write(self.total_supply.read() + amount);
            let zero_address: ContractAddress = 0.try_into().unwrap();
            self.emit(Event::Transfer(Transfer { from: zero_address, to: account, value: amount }));
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self
                .emit(
                    Event::Approval(Approval { owner, spender, value: amount }),
                );
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowance = self.allowances.read((sender, spender));
            assert!(allowance >= amount, "INSUFFICIENT_ALLOWANCE");

            let sender_balance = self.balances.read(sender);
            assert!(sender_balance >= amount, "INSUFFICIENT_BALANCE");

            self.allowances.write((sender, spender), allowance - amount);
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.emit(Event::Transfer(Transfer { from: sender, to: recipient, value: amount }));
            true
        }
    }
}
