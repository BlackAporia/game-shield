#!/usr/bin/env node
/* verify-strk20-txs.mjs — after the user runs Fund/Payout flows in the dapp,
 * scan recent blocks for the helper's Funded / PayoutCommitted events and
 * confirm each carrying tx also touched the STRK20 pool.
 * Prints the qualifying tx hashes for strk20.json.
 */
import { RpcProvider, hash } from "starknet";

const HELPER = "0x034525253fd76049c7472059b522cdb51bc1963d35c30eee6deb20f6b4259256";
const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const RPC = "https://rpc.starknet.lava.build";
const LOOKBACK = Number(process.env.LOOKBACK ?? 400); // blocks

const FUNDED = hash.getSelectorFromName("Funded");
const PAID = hash.getSelectorFromName("PayoutCommitted");

const provider = new RpcProvider({ nodeUrl: RPC });
const last = await provider.getBlockNumber();
const from = Math.max(1, last - LOOKBACK);

console.log(`scanning blocks ${from}..${last} for helper events`);

const found = [];
for (let b = from; b <= last; b++) {
  const blk = await provider.getBlockWithTxHashes(b);
  if (!blk.transactions.length) continue;
  for (const tx of blk.transactions) {
    let r;
    try {
      r = await provider.getTransactionReceipt(tx.transaction_hash);
    } catch {
      continue;
    }
    const evs = r.events ?? [];
    const hasHelperEvent = evs.some(
      (e) => e.from_address === HELPER && (e.keys[0] === FUNDED || e.keys[0] === PAID)
    );
    const hasPoolTouch = evs.some((e) => e.from_address === POOL);
    if (hasHelperEvent && hasPoolTouch) {
      const kind = evs.find((e) => e.from_address === HELPER).keys[0] === FUNDED ? "Funded" : "PayoutCommitted";
      found.push({ block: b, kind, tx: r.transaction_hash });
      console.log(`✓ block ${b} ${kind}: ${r.transaction_hash}`);
    } else if (hasHelperEvent) {
      console.log(`⚠ block ${b} helper event but NO pool touch (not qualifying): ${r.transaction_hash}`);
    }
  }
}

console.log(`\nqualifying: ${found.length}`);
for (const f of found) console.log(`${f.kind}: ${f.tx}`);