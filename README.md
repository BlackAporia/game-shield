# GameShield — Private Gaming Bounty Hub

GameShield is a STRK20 prototype for private gaming reward flows on Starknet. It uses the STRK20 pool and an app-specific `privacy_invoke` helper so the dapp does not handle viewing keys, notes, proofs, or recipient private keys.

## Why STRK20

Every bounty system leaks payment information. GameShield reduces recipient-linkage exposure by routing reward delivery through STRK20 shielded notes:

- **Organizers** shield STRK into private notes held by their wallet.
- **Winners** receive an open private note through a `privacy_invoke` helper after the organizer selects a winner.
- **Payouts are verifiable** — the pool verifies proofs and the helper emits a commitment, not a plaintext recipient.

### Privacy and current limitations

- Deposits, withdrawals to the helper, helper events, campaign IDs, reward amounts, and timing are public. GameShield does **not** provide full unlinkability against amount/timing correlation.
- The current `Fund` helper action records an on-chain funding signal but returns the private note to the organizer. It is **not escrow** and does not reserve a campaign prize. Do not treat a campaign as collateralized until the planned stateful escrow helper is deployed and independently tested.
- Winners need a STRK20-compatible wallet with viewing-key registration and note-discovery support.
- Campaign reward and exact deadline are stored on-chain. Title, places and detailed rules are local MVP metadata whose integrity commitment is stored in `criteria_hash`; they are not yet shared across browsers because the project has no metadata indexer.

## Architecture

| Component | Role |
| --- | --- |
| `contracts/` | Cairo contracts: campaign registry + `privacy_invoke` payout helper |
| `apps/web` | Next.js dapp (STRK20 starter kit base): browse, create, fund, verify, payout |

### Onchain flow (one STRK20 transaction per action)

```
shield:       wallet.strk20InvokeTransaction([{ deposit }])
payout:       wallet.strk20InvokeTransaction([{ transfer: "OPEN" },
               { invoke: helper, calldata: [...] }])
               -> pool withdraws -> helper validates -> winner open note
```

The dapp never touches viewing keys — the wallet (Wallet API 0.10.3, e.g. Ready) manages notes, proofs, and submission via `starknet.js` `WalletAccountV6` (`strk20InvokeTransaction`).

## Sprint artifacts

- `strk20.json` — mainnet transactions, contracts, demo links (filled as they exist).
- `docs/strk20-integration.md` — integration research, mainnet parameters, transaction plan.

## On-chain deployment (mainnet)

| Component | Address |
| --- | --- |
| CampaignRegistry | `0x03ce58babb9bc3651131657c273aae00cca554ffdccb13dba8b2d06ce60d61d5` |
| PayoutHelper | `0x034525253fd76049c7472059b522cdb51bc1963d35c30eee6deb20f6b4259256` |

Both are verified on-chain (class + state readable). The helper is linked to the
registry via `set_helper`. Registry state is authoritative: 5 test campaigns
were created and all cancelled on-chain (status `Cancelled`), so the list is
empty and ready for real bounties.

## Verify locally

The contracts require Scarb `2.18.0` and Starknet Foundry `0.60.0`:

```bash
cd contracts
scarb --version
snforge test
```

Expected result: 10 tests passed. `scarb test` is not the project test command; use `snforge test` so the integration tests under `contracts/tests` are collected.

## Status

- [x] PHASE 1 — discover (integration route chosen: Starknet Wallet API + anonymizer helper)
- [x] PHASE 2 — GitHub repo + skeleton + registration PR (#86, blocked by a dead registry entry on the sprint repo — not ours)
- [x] PHASE 3 — Cairo prototype (campaign registry + `privacy_invoke` helper); unit tests are mock-based
- [x] PHASE 4 — web app (Next.js on the STRK20 starter kit base) — **live: https://gameshield-dapp.vercel.app**
- [ ] PHASE 5 — three qualifying mainnet STRK20 pool transactions (shield + private payouts through the helper); the wallet holds ~3,895 STRK and is ready
- [ ] PHASE 6 — demo video + submission (strk20.json `transactions` / `demo_video`)

## License

MIT
