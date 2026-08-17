# GameShield — Private Gaming Bounty Hub

GameShield brings privacy to gaming bounties on Starknet. Players and organizers use the STRK20 privacy pool so that no one can link bounty rewards, payouts, or participation to a wallet — private by default, disclosed only when a campaign requires it.

## Why STRK20

Every bounty system leaks the same thing: who was paid, how much, and by whom. GameShield replaces the public ledger with the STRK20 shielded pool:

- **Organizers** shield campaign prize pools into the pool as private notes.
- **Winners** get paid through a `privacy_invoke` helper: the pool withdraws to our helper, we record the payout commitment, and the winner's reward lands as an open private note — no public leg between bounty and winner.
- **Payouts are provable** — the pool verifies every proof; our helper emits only commitments, never plaintext recipients.

## Architecture

| Component | Role |
| --- | --- |
| `contracts/` | Cairo contracts: campaign registry + `privacy_invoke` payout helper |
| `apps/web` | Next.js dapp (STRK20 starter kit base): browse, create, fund, verify, payout |

### Onchain flow (one STRK20 transaction per action)

```
shield/fund:  wallet.strk20InvokeTransaction([{deposit}])           → pool, our helper event
payout:       wallet.strk20InvokeTransaction([{transfer:"OPEN"},
              {invoke: helper, calldata:[campaign, winner, "${openNoteIds[0]}"]}])
              → pool withdraws → helper verifies → returns OpenNoteDeposit → winner's note
```

The dapp never touches viewing keys — the wallet (Wallet API 0.10.3, e.g. Ready) manages notes, proofs, and submission via `starknet.js` `WalletAccountV6` (`strk20InvokeTransaction`).

## Sprint artifacts

- `strk20.json` — mainnet transactions, contracts, demo links (filled as they exist).
- `docs/strk20-integration.md` — integration research, mainnet parameters, transaction plan.

## Status

- [x] PHASE 1 — discover (integration route chosen: Starknet Wallet API + anonymizer helper)
- [ ] PHASE 2 — project skeleton + GitHub repo + registration PR
- [ ] PHASE 3 — Cairo contracts (registry, payout helper) + tests
- [ ] PHASE 4 — web app (starter kit fork)
- [ ] PHASE 5 — deployment + mainnet transactions
- [ ] PHASE 6 — demo video + submission

## License

MIT