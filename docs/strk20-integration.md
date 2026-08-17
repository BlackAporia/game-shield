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

1. `campaign_registry.cairo` — public campaign state: create campaign (deadline, reward amount, payout criteria hash), bind funding, approve payout entitlement, complete/cancel with refund; access control; replay protection. Emits events for every lifecycle step.
2. `payout_helper.cairo` — `privacy_invoke` entrypoint:
   - `FUND`: organizer shields through the helper — helper verifies caller is the pool, records campaign funding commitment, returns the open note to the organizer.
   - `PAYOUT`: helper verifies payout entitlement, records a payout commitment (hash of campaign + winner + amount; no plaintext recipient onchain), emits event, returns `OpenNoteDeposit { note_id, token, amount }` so the pool credits the winner's open note.

All events public but carry only commitments — this satisfies "tx must carry an event from our contract" (CONTRIBUTING.md) since every transaction also touches the pool atomically.

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

## 7. Next phases

2. Skeleton → GitHub repo → registration PR (fork + registry.json append)
3. Cairo contracts + snforge tests
4. Web app (fork starter kit; swap Alchemy for Lava RPC)
5. Deploy (starkli) + mainnet transactions
6. strk20.json fill + demo video + submit