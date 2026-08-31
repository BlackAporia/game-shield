# GameShield — Gaming Bounty Hub

GameShield is a Starknet application for running gaming bounties end to end: organizers fund a reward pot through STRK20, review applicants, split the pot across any number of winners, and each winner claims their reward directly — with automatic, permissionless refund paths and no admin or dispute role anywhere in the contract.

Built for the **STRK20 Private Sprint**.

## Contents

- [How it works](#how-it-works)
- [Design decision: from commit-reveal to public payout](#design-decision-from-commit-reveal-to-public-payout)
- [Privacy model and current limitations](#privacy-model-and-current-limitations)
- [Features](#features)
- [Architecture](#architecture)
- [On-chain flow](#on-chain-flow)
- [Deployment (mainnet)](#deployment-mainnet)
- [Getting started](#getting-started)
- [Status](#status)
- [License](#license)

## How it works

- **Organizers** fund a campaign from a STRK20-capable wallet. Funding withdraws the reward token to the GameShield contract and calls its deposit-only `privacy_invoke` entry point, which records the deposit — nothing more.
- **Participants** connect a wallet and apply to a campaign. The organizer reviews applicants and assigns one or more winner slots from that list.
- **Winners** are assigned by their real wallet address. Only that address can claim its slot; the contract pays it out directly with a plain ERC-20 `transfer`.
- **Refunds** are fully automatic and permissionless. Unallocated funds (after the assignment grace period) and unclaimed expired slots (after the claim expiry window) both sweep into the campaign's `refund_pool`, which only the organizer can drain — back to their own address, no separate commitment required.

GameShield doesn't build its own shielding feature. Ready and Xverse already do this well through the STRK20 Wallet API, so organizers fund from a shielded balance in their own wallet rather than GameShield handling viewing keys, notes, or proofs itself.

## Design decision: from commit-reveal to public payout

The contract originally paid winners through a commit-reveal scheme (`CommitClaim` / `RevealClaim`), so a claimant's identity stayed hidden until the moment they claimed. That required submitting a secret in the reveal transaction's calldata — and Starknet calldata is visible in the mempool before a transaction confirms. In principle, anyone watching a pending `RevealClaim` could read the secret and race it with a competing claim.

The underlying exposure only existed because the *payout destination* was still decided at reveal time, by whoever submitted it. Once we noticed that, the fix was simpler than patching around the race: remove that degree of freedom entirely. `add_winner` now takes the winner's real wallet address directly — the organizer already has it, since they're picking from a list of applicants. A slot's payout is fixed the moment it's assigned, long before any claim transaction exists, so there's nothing left in a pending claim for a bystander to steal.

The tradeoff is disclosed, not hidden: winner identity is now public from the moment of assignment, rather than staying private until claim. Funding privacy and winner-selection privacy (nobody can predict a slot's destination before the organizer assigns it) are unaffected — this narrows the privacy window at the very end of the flow, it doesn't remove it.

## Privacy model and current limitations

- Funding can originate from a shielded STRK20 balance, but GameShield does not provide full transaction unlinkability or hide amount/timing correlation.
- Campaign IDs, token addresses, reward pots, deadlines, winner addresses, slot amounts, assignments, claims, and refunds are all public on-chain data.
- Winner identity is public from the moment the organizer assigns a slot (see above).
- The contract performs no on-chain game verification or eligibility check — the organizer selects winners from the application list.
- Wallet sign-in uses a Starknet signature-based session before any protected organizer action or backend write.
- Campaign descriptions and participant applications are stored off-chain (Supabase). Winner slots and payment state are authoritative on-chain.

## Features

- **Multiple winners** — each campaign can have any number of independently-sized winner slots.
- **Direct claims** — a winner claims with one ordinary Starknet account transaction; the contract checks the caller against `winner_address`, nothing else.
- **Multi-token rewards** — the frontend supports STRK, ETH, USDC, USDT, DAI, WBTC, wstETH, xSTRK, LORDS, and EKUBO, with token-specific decimal handling.
- **Permissionless timeout recovery** — anyone can sweep unallocated funds after the assignment grace period, or an unclaimed slot after its expiry window.
- **Organizer refunds** — the organizer drains the accumulated refund pool directly to their own address, any time after funds land there.
- **Applicant flow** — participants apply with their connected wallet; organizers assign winner slots from that applicant list.
- **Wallet compatibility** — a STRK20-capable wallet is required for funding. Claims, winner assignment, and refunds are ordinary account transactions, so any standard Starknet wallet works for those.

## Architecture

| Component | Role |
| --- | --- |
| `contracts/src/gameshield.cairo` | Current GameShield contract: campaign lifecycle, funding, winner slots, direct claims, timeout sweeps, refunds. |
| `contracts/tests/test_gameshield.cairo` | Starknet Foundry tests: validation, permissions, funding, winner assignment, claims, refunds, solvency, timeout paths. |
| `apps/web` | Next.js frontend: campaign discovery, wallet connection, signature sign-in, applications, funding, winner assignment, claims, refunds. |
| Supabase | Off-chain storage for campaign descriptions and participant applications. |

Earlier contract iterations (`contracts/src/campaign_registry.cairo`, `contracts/src/payout_helper.cairo`) are kept for reference only — they are not part of the current payout flow.

## On-chain flow

Funding is submitted by a STRK20-capable wallet as one transaction with a withdraw action and a contract invoke:

```ts
fund: [
  { type: "withdraw", token, amount, recipient: gameshieldAddress },
  {
    type: "invoke",
    contract: gameshieldAddress,
    calldata: [campaignId, token, amount],
  },
]
```

The invoke calldata matches `privacy_invoke(campaign_id, token, amount)`. This only ever funds a campaign now — it returns an empty `Span<OpenNoteDeposit>`, since claims no longer route through the pool at all.

Winner assignment: `add_winner(campaign_id, amount, winner_address)`.
Claiming: `claim_winner(campaign_id, slot_id)` — the caller must be `winner_address`; the contract pays out directly.
Refunds: `claim_refund(campaign_id)` — organizer-only, drains `refund_pool` to the organizer's own address.

All three are plain account transactions. The frontend uses `starknet.js`'s `WalletAccountV6` and the STRK20 Wallet API only for the funding step; GameShield never accesses wallet viewing keys or private note data.

## Deployment (mainnet)

GameShield contract: `0x075a60637214544e9aae248355da84aef5819bf1830308451eb5ceeb10e040fc`

## Getting started

### Contracts

Requires Scarb `2.18.0`. `snforge_std` is pinned to `v0.60.0`:

```bash
cd contracts
scarb build
snforge test
```

### Frontend

```env
NEXT_PUBLIC_GAMESHIELD_CONTRACT_ADDRESS=...
NEXT_PUBLIC_STRK20_POOL_ADDRESS=...
NEXT_PUBLIC_STARKNET_RPC_URL=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-side only and back campaign descriptions and applications — the app needs both to run.

```bash
cd apps/web
npx tsc --noEmit
npm run build
npm run dev
```

## Status

- [x] Public-address winner assignment and direct claim flow.
- [x] Multiple winner slots with per-slot reward amounts.
- [x] STRK20 wallet funding through withdraw plus deposit-only invoke.
- [x] Permissionless unallocated-fund and expired-slot sweeps.
- [x] Organizer refund-pool claims.
- [x] Applicant flow and organizer applicant picker.
- [x] Signature-based wallet sessions for protected actions.
- [x] Mainnet deployment.

## License

MIT
