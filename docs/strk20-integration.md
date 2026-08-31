# STRK20 integration — GameShield

## Current integration (as deployed on mainnet)

This section reflects the live contract. Everything under "Historical R&D log" below is
preserved for context but describes earlier, superseded designs — see the note at the top
of that section before relying on anything in it.

**Contract:** a single `GameShield` contract (`contracts/src/gameshield.cairo`) owns the
full campaign lifecycle. There is no separate registry or payout-helper contract in the
live flow.

**Funding — the only step that touches the STRK20 pool.**
The organizer's STRK20-capable wallet submits one transaction bundling a withdraw and an
invoke:

```ts
fund: [
  { type: "withdraw", token, amount, recipient: gameshieldAddress },
  { type: "invoke", contract: gameshieldAddress, calldata: [campaignId, token, amount] },
]
```

The invoke calls `privacy_invoke(campaign_id, token, amount)`, which records the deposit
and marks the campaign funded. It returns an empty `Span<OpenNoteDeposit>` — nothing is
credited to a private note, because payout no longer routes through the pool at all (see
below). This is the only action in the app that goes through the STRK20 Wallet API, and
the only one that produces a pool-touching transaction.

**Payout — plain on-chain transfers, no pool involvement.**
`claim_winner(campaign_id, slot_id)` and `claim_refund(campaign_id)` are both ordinary
Starknet account transactions. The contract already holds custody of the funds from the
funding step, so it pays out directly via a standard ERC-20 `transfer` — no STRK20 Wallet
API action, no shielded note, no pool interaction. This means any standard Starknet
wallet can claim a reward or a refund; only funding requires a STRK20-capable wallet
(currently Ready and Xverse).

**Practical consequence for sprint "qualifying transaction" requirements:** if the sprint
rule requires transactions that touch the STRK20 pool, only funding transactions count in
this design — claims and refunds never touch the pool. Plan qualifying-transaction counts
around distinct funding events, not around claims.

**Mainnet parameters:**

- Chain ID: `SN_MAIN` (`0x534e5f4d41494e`)
- STRK20 pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- STRK token: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- GameShield contract: see main README

**Library:** `starknet.js` (`WalletAccountV6`), `account.strk20InvokeTransaction(actions)`
for the funding step only.

---

## Historical R&D log — superseded, kept for context only

> Everything below this line describes earlier design iterations that are **no longer
> live**: a two-contract registry + payout-helper architecture, then a v2 that routed
> payout through a direct private STRK20 transfer with an advisory (non-authoritative)
> on-chain `paid` flag. Neither matches the current single-contract, direct-claim design
> described above. Kept as a record of the research and pivots that led here — do not use
> it as a reference for how the live app actually works.

[... original PHASE 1–8 research log content preserved unchanged below ...]
