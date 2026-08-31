#!/usr/bin/env node
/* verify-strk20-txs.mjs — after the user runs the Fund/Payout flows in the
 * dapp, scan recent blocks for transactions that touch the STRK20 privacy pool
 * (a deposit, private transfer or withdrawal emits pool events).
 * Prints the qualifying tx hashes for strk20.json.
 */
import { RpcProvider, hash } from "starknet";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const RPC = "https://rpc.starknet.lava.build";
const LOOKBACK = Number(process.env.LOOKBACK ?? 500); // blocks

// Pool event selectors (STRK20 privacy pool emits pool events for every action).
const POOL_SELECTORS = [
  "ShieldedDeposit",
  "ShieldedTransfer",
  "ShieldedWithdrawal",
  "ShieldedMint",
  "ShieldedBurn",
  "OpenNoteDeposited",
  "NoteCommitted",
  "NoteDestroyed",
].map((n) => numToHexSelector(n));

function numToHexSelector(name) {
  return hash.getSelectorFromName(name);
}

const provider = new RpcProvider({ nodeUrl: RPC });
const last = await provider.getBlockNumber();
const from = Math.max(1, last - LOOKBACK);

console.log(`scanning blocks ${from}..${last} for pool events`);

const found = [];
let scanned = 0;
for (let b = from; b <= last; b++) {
  const blk = await provider.getBlockWithTxHashes(b);
  if (!blk.transactions.length) continue;
  scanned++;
  for (const tx of blk.transactions) {
    let r;
    try {
      r = await provider.getTransactionReceipt(tx.transaction_hash);
    } catch {
      continue;
    }
    if (r.execution_status === "REVERTED") continue;
    const evs = r.events ?? [];
    const poolEvents = evs.filter((e) => e.from_address === POOL);
    if (poolEvents.length) {
      const kinds = poolEvents
        .map((e) => e.keys[0])
        .filter((k) => POOL_SELECTORS.includes(k))
        .join(",");
      found.push({ block: b, tx: r.transaction_hash, kinds });
      console.log(`✓ block ${b} pool touch: ${r.transaction_hash}`);
    }
  }
}

console.log(`\nqualifying: ${found.length} (touched the STRK20 pool, succeeded)`);
for (const f of found) console.log(`${f.tx}`);
