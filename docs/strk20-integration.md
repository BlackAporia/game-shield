# PHASE 1 — DISCOVER: STRK20 integration research for GameShield

Status: complete. Date: 2026-08-17.
Sources: strk20-by-example.org (llms-full.txt), strk20.starknet.io/build, Akashneelesh/strk20-starter-kit, starkience/strk20-hackathon (registry.json, CONTRIBUTING.md, MAINNET-DAY-0.md), starkware-libs/starknet-privacy (SDK README).

## 1. Mainnet parameters (official)

- Chain ID: `SN_MAIN` (`0x534e5f4d41494e`)
- RPC: `https://rpc.starknet.lava.build` (free, no key) — agent prompt suggests Alchemy `https://starknet-mainnet.g.alchemy.com/v2/<KEY>` in env var
- STRK20 pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- SDK mainnet discovery/proving endpoints: not officially published yet (StarkWare-hosted) — not needed for wallet route

## 2. Integration route: Starknet Wallet API (chosen)

Two routes exist; the wallet route is chosen because the dapp never touches viewing keys (better security story for a hackathon), needs no SDK mainnet endpoints, and works with the Ready wallet today.

- Library: `starknet@^10.4.0` — STRK20 API ships on npm `next` tag; `latest` (10.0.x) lacks it. Pin the version.
- Account class: `WalletAccountV6` (get-starknet v6). Wallet must support Wallet API `0.10.3` (capability check: `supportedWalletApi`).
- Single API: `account.strk20InvokeTransaction(actions: STRK20_ACTION[])`.
- Actions:
  - `{ type: "deposit", token, amount }` — shield (public deposit, screened by FPI)
  - `{ type: "transfer", token, amount, recipient }` — private transfer; `amount: "OPEN"` opens an open note whose amount is set by the helper output
  - `{ type: "invoke", contract, calldata }` — calls our helper's `privacy_invoke`; placeholders `${openNoteIds[N]}` and `${poolAddress}` resolved wallet-side; at most one invoke per transaction
  - unshield/withdraw available for organizers who need funds back
- Dry-run: `strk20PrepareInvoke` proves without submitting.

## 3. Helper contract pattern (anonymizer)

The pool calls our contract's `privacy_invoke` entrypoint via `INVOKE_SELECTOR` inside a pool transaction, sandwich:

```
pool withdraws input token to helper → helper runs arbitrary logic → helper approves pool → returns Span<OpenNoteDeposit>
```

- `fn privacy_invoke(ref self, ...) -> Span<OpenNoteDeposit>`; return type must be exactly `Span<OpenNoteDeposit>`; empty span = "park funds, credit nothing" (stateful claim pattern).
- **Escrow pattern (from welttowelt/strk20-skills, helpers__escrow.md)**: deposit parks funds behind `poseidon(TAG, secret)` commitment (empty span returned), claim verifies the preimage, marks claimed, approves pool, returns the open-note deposit. Access control: `privacy_invoke` asserts caller == pool. This solves "recipient not registered yet" — directly applicable to bounty payouts.
- Calldata order must match the helper's parameter list; the pool deserializes directly.
- Observers see pool → helper only, never who initiated.
- Deposit screening (FPI) mandatory on deposits; deposits are public. ~10-block note maturity between related transactions.

## 4. GameShield contract plan

Two Cairo contracts (Scarb + Starknet Foundry):

1. `campaign_registry.cairo` — public campaign metadata and payout entitlement. The currently deployed version does **not** bind funding, enforce the deadline, or implement refunds.
2. `payout_helper.cairo` — `privacy_invoke` entrypoint:
    - `FUND`: current prototype records a campaign funding signal and returns the open note to the organizer. This is not escrow and must not be described as reserved prize liquidity.
   - `PAYOUT`: helper verifies payout entitlement, records a payout commitment (hash of campaign + winner + amount; no plaintext recipient onchain), emits event, returns `OpenNoteDeposit { note_id, token, amount }` so the pool credits the winner's open note.

Events are public. They expose campaign IDs and amounts, so they do not provide amount or timing privacy; the helper only avoids publishing a plaintext recipient address.

## 5. Transaction plan (mainnet, all via strk20InvokeTransaction)

| # | Action | Pool | Our contract event |
| --- | --- | --- | --- |
| 1 | FUND — organizer shields campaign prize through helper | withdraw+deposit | Funded |
| 2 | PAYOUT 1 — winner reward through helper | withdraw+credit open note | PayoutCommitted |
| 3 | PAYOUT 2 — second winner / second campaign | withdraw+credit open note | PayoutCommitted |

Requires the organizer's wallet with STRK on mainnet (real funds — user action).

## 6. Tooling / blockers

- Installed: scarb 2.18.0, starkli 0.4.2, sncast 0.60.0, node v22.22.2, cargo 1.95.0. gh CLI not installed.
- Node v22.22.2 is fine for the wallet route (SDK route would need Node ≥ 24).
- Registration needs: public GitHub repo (user creates it — SSH auth works, gh absent), Telegram username.
- Skills installed at `.agents/skills/`: `strk20-privacy-integration` (starkience agent prompt skill) + `strk20-privacy`, `strk20-wallet-api`, `strk20-privacy-sdk`, `strk20-anonymizer-contracts` (welttowelt/strk20-skills).

## 7. Status update (2026-08-17)

- PHASE 1 done (this doc); PHASE 2 done: repo live at github.com/BlackAporia/game-shield, registration PR #86 opened — merge blocked by a pre-existing dead entry on the sprint repo (`Portablelle/veilance-market` returns 404), not by our entry (our entry validated as #64).
- PHASE 3 prototype: `contracts/src/campaign_registry.cairo` + `payout_helper.cairo`. Tests use a mock ERC-20 and impersonated pool calls; they are not a STRK20 integration test.
- PHASE 4 prototype: Next.js app in `apps/web` (build passes): campaign create, helper Fund/Payout preparation, and event parsing. Ready X fee-review compatibility for ordinary registry invokes remains unverified and currently fails in the observed create-campaign flow.
- Verified on mainnet via RPC: STRK = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d ("Starknet Token"), pool = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a (deployed).

## 7b. Status update (2026-08-18 — full audit)

- **Deployment verified on-chain**: registry 0x03ce58babb…61d5 and helper 0x034525253f…9256 both have live classes; `set_helper` linkage confirmed; 5 test campaigns all `Cancelled` (cancel txns landed: blocks 13478726–13478791). Ready X fee review failed transiently once then succeeded on retry.
- **Builds green**: `tsc --noEmit` + `next build` (Next.js 16.3.1) pass; Cairo builds with scarb 2.18.0 (`asdf` pinned in `.tool-versions`); `snforge test` 10/10 pass.
- **Secrets**: no keys/tokens in git; `.env*` ignored; only public RPC + contract addresses configured.
- **Live site**: gameshield-dapp.vercel.app serves the latest commit (page chunk 0c81fccb77dbf881 contains both contract addresses + enum-variant parsing); Vercel project `gameshield` (env: NEXT_PUBLIC_REGISTRY_ADDRESS, NEXT_PUBLIC_HELPER_ADDRESS) auto-deploys from GitHub main.
- **Registration**: PR #86 passes the registration check; the only blocker is the dead `veilance-market` entry on the sprint repo main, which fails shared validation for every open PR since Aug 17 10:54. Removal PR #93 (registry.json + registry-removals.json) passes both validators but the bot only applies single-file PRs — it needs a maintainer merge. Maintainer nudged on #93 and #96.
- **Qualifying transactions**: none yet. Rules require ≥3 mainnet txns that touch the STRK20 pool AND carry an event from one of our contracts. The dapp's Fund (helper `Funded` event) and Payout (`PayoutCommitted`) flows qualify; shield/unshield alone do not (no event from our contracts). Organizer wallet holds ~3,895 STRK on mainnet. Plan: create bounty → shield → Fund → Complete → Payout (x2) gives 3+ qualifying txns; fill `transactions` in strk20.json after each.

## 8. Next phases

5. Run the 3 qualifying mainnet transactions (Fund + 2 Payouts through the helper) with the organizer wallet, then list the hashes in strk20.json
6. Demo video (≤3 min) + verify the project row renders on strk20.starknet.io/hackathon
