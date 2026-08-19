# GameShield — Private Gaming Bounty Hub

GameShield is a STRK20 prototype for private gaming reward flows on Starknet. It uses the STRK20 pool directly — rewards are deposited, transferred and withdrawn as shielded notes by the wallet's Wallet API, so the dapp never handles viewing keys, notes, proofs, or recipient private keys.

## Why STRK20

Every bounty system leaks payment information. GameShield reduces recipient-linkage exposure by routing reward delivery through STRK20 shielded notes:

- **Organizers** shield any supported token (STRK, ETH, USDC, USDT, DAI, WBTC, wstETH, xSTRK, LORDS, EKUBO, …) into private notes held by their wallet.
- **Winners** receive a private note straight from the organizer's shielded balance — the pool settles the transfer without publishing who won or how much.
- **Payouts are verifiable** — the registry records a commitment (a hash of campaign id and winner address), never the plaintext winner.

### Privacy and current limitations

- Deposits, pool events, campaign IDs, reward amounts, and timing are public. GameShield does **not** provide full unlinkability against amount/timing correlation.
- Funding a campaign shields the reward into the organizer's own note. It is **not escrow** and does not reserve a campaign prize on-chain. Treat a campaign as a commitment until the organizer proves the shielded balance.
- Winners need a STRK20-compatible wallet (Ready, Xverse). Other wallets (Braavos, MetaMask) can create and complete campaigns but cannot perform private payouts.
- Campaign reward, token and exact deadline are stored on-chain. Title, places and detailed rules are local MVP metadata whose integrity commitment is stored in `criteria_hash`; they are not yet shared across browsers because the project has no metadata indexer.

## Features

- **Private rewards** — Fund = private `deposit` of the reward amount, Payout = private `transfer` of the reward amount to the winner. No `OPEN` literal, no invoke actions: these are the action variants every STRK20 wallet implements (verified by on-mainnet probes).
- **Multi-token rewards** — the campaign registry stores the reward token on-chain; the dapp supports 10 major Starknet tokens with correct decimals.
- **On-chain title** — title, places and description are committed to the registry (`criteria_hash`) so the campaign metadata survives across browsers; full discovery still requires a metadata indexer.
- **Wallet compatibility** — Ready X and Xverse support the STRK20 Wallet API (deposit / transfer / withdraw). Braavos and MetaMask do not — they can create and complete campaigns but cannot perform private payouts; the dapp degrades gracefully.

## Architecture

| Component | Role |
| --- | --- |
| `contracts/` | Cairo contracts: campaign registry (multi-token) + payout helper (helper is **not used by the live v2 flow**; kept for reference) |
| `apps/web` | Next.js dapp: browse, create, fund, send private reward |

> **v2 flow note:** the v2 dapp uses direct STRK20 `deposit` / `transfer` actions on the privacy pool and bypasses the PayoutHelper contract in the live flow (the `paid` flag on the registry is therefore never set on-chain; the privacy-invoke path was hindered by Ready X not supporting the `OPEN` literal / invoke actions). The PayoutHelper contract is still deployed and remains in the repository for reference, but the live v2 flow does not call it.
>
> **SEC-01 honesty note (added 2026-08-19):** the dapp performs a direct STRK20 `transfer` from the organizer's shielded note to the winner. The registry's `paid` flag is therefore **advisory (informational)** and may be inconsistent with actual settlement. The dapp UI labels the payout action "Send private reward" and shows the advisory note in the receipt and on completed-but-unpaid campaign cards. Treat the `paid` flag as a hint, not as proof of payment.

### Onchain flow (one STRK20 transaction per action)

```
fund:         wallet.strk20InvokeTransaction([{ deposit, token, amount }])
payout:       wallet.strk20InvokeTransaction([{ transfer, token, amount, recipient }])
```

The dapp never touches viewing keys — the wallet (Wallet API 0.10.3+, e.g. Ready, Xverse) manages notes, proofs, and submission via `starknet.js` `WalletAccountV6` (`strk20InvokeTransaction`).

> **Note:** PayoutHelper is a reference implementation kept deployed for future escrow/v2.5 work; the live flow uses direct STRK20 transfer.

## Sprint artifacts

- `strk20.json` — mainnet transactions, contracts, demo links (filled as they exist).
- `docs/strk20-integration.md` — integration research, mainnet parameters, transaction plan.

## On-chain deployment (mainnet)

Campaign registry and payout helper are deployed fresh per redeploy; the dapp accepts the most recently declared class hashes plus the v1/v2 historical hashes. Deploy from the dapp's Developer settings, or paste already-deployed addresses. The dapp's `Save addresses` flow verifies via ABI (`get_campaign_count` on the registry, `privacy_invoke` on the helper) and falls back to class-hash matching against the v1 STRK-only and v2 multi-token hashes when the ABI cannot be fetched.

| Component | Address |
| --- | --- |
| CampaignRegistry (v2) | deployed from dapp |
| PayoutHelper (reference, informational) | deployed from dapp (live v2 flow does not call it) |

## Verify locally

The contracts require Scarb `2.18.0` and Starknet Foundry `0.60.0`:

```bash
cd contracts
scarb --version
snforge test
```

Expected result: 10 tests passed. `scarb test` is not the project test command; use `snforge test` so the integration tests under `contracts/tests` are collected.

## Status

- [x] PHASE 1 — discover (integration route chosen: Starknet Wallet API, direct pool actions)
- [x] PHASE 2 — GitHub repo + skeleton + registration PR (#86, blocked by a dead registry entry on the sprint repo — not ours)
- [x] PHASE 3 — Cairo prototype (multi-token campaign registry + payout helper); unit tests are mock-based
- [x] PHASE 4 — web app (Next.js on the STRK20 starter kit base) — **live: https://gameshield-dapp.vercel.app**
- [x] PHASE 5a — probe on mainnet: deposit / transfer / withdraw accepted, `OPEN` literal not implemented by Ready
- [ ] PHASE 5b — three qualifying mainnet STRK20 pool transactions with the v2 flow (deposit fund + private payout + unshield); the wallet holds ~3,895 STRK and is ready
- [ ] PHASE 6 — demo video + submission (strk20.json `transactions` / `demo_video`)

## License

MIT