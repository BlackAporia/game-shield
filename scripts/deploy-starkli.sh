#!/usr/bin/env bash
# deploy-starkli.sh — deploy GameShield v5 contracts using starkli CLI
# (bypasses the Ready X fee-review issue with unknown custom contracts).
#
# Prerequisites:
#   - starkli 0.3+ (https://book.starkli.rs/installation)
#   - An account config + signer configured (account JSON + keystore, or
#     STARKNET_PRIVATE_KEY). See: https://book.starkli.rs/signers
#   - scarb 2.18+ to build contracts.
#
# Usage:
#   OWNER_ADDRESS=<your address> bash scripts/deploy-starkli.sh
#
#   If OWNER_ADDRESS is omitted, it is derived from your starkli account
#   config (STARKNET_ACCOUNT) via `starkli account fetch`.
#
# Output:
#   Writes scripts/deploy-output.json with the deployed addresses and
#   class hashes. Paste those into the dapp's Developer settings → Save.
#
# Environment (optional overrides):
#   POOL_ADDRESS - STRK20 pool (default: mainnet STRK pool)
#   RPC_URL      - mainnet RPC (default: https://rpc.starknet.lava.build)

set -euo pipefail

cd "$(dirname "$0")/.."

RPC_URL="${RPC_URL:-https://rpc.starknet.lava.build}"
POOL_ADDRESS="${POOL_ADDRESS:-0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a}"

# --- 0. Resolve owner address ---
if [[ -n "${OWNER_ADDRESS:-}" ]]; then
  OWNER="$OWNER_ADDRESS"
elif [[ -n "${STARKNET_ACCOUNT:-}" ]]; then
  echo "==> OWNER_ADDRESS not set — fetching it from starkli account config"
  TMP_OUT="${TMPDIR:-/tmp}/gameshield-account.json"
  starkli account fetch --output "$TMP_OUT" --account "$STARKNET_ACCOUNT" --rpc "$RPC_URL" >/dev/null 2>&1
  OWNER=$(python3 -c "import json; print(json.load(open('$TMP_OUT'))['deployment']['address'])")
else
  echo "ERROR: set OWNER_ADDRESS=<your Starknet address> (or configure STARKNET_ACCOUNT)." >&2
  exit 1
fi
echo "    owner: $OWNER"

# --- 1. Build ---
echo "==> Building contracts with scarb"
scarb build

# --- 2. Declare registry ---
echo "==> Declaring CampaignRegistry"
REG_CLASS_HASH=$(starkli declare \
  contracts/target/dev/gameshield_CampaignRegistry.contract_class.json \
  --rpc "$RPC_URL" 2>/dev/null | tail -1)
echo "    class_hash: $REG_CLASS_HASH"

# --- 3. Deploy registry ---
echo "==> Deploying CampaignRegistry"
REG_ADDRESS=$(starkli deploy "$REG_CLASS_HASH" \
  --rpc "$RPC_URL" \
  "$OWNER" 2>/dev/null | tail -1)
echo "    contract_address: $REG_ADDRESS"

# --- 4. Declare helper ---
echo "==> Declaring PayoutHelper"
HELP_CLASS_HASH=$(starkli declare \
  contracts/target/dev/gameshield_PayoutHelper.contract_class.json \
  --rpc "$RPC_URL" 2>/dev/null | tail -1)
echo "    class_hash: $HELP_CLASS_HASH"

# --- 5. Deploy helper ---
echo "==> Deploying PayoutHelper"
HELP_ADDRESS=$(starkli deploy "$HELP_CLASS_HASH" \
  --rpc "$RPC_URL" \
  "$POOL_ADDRESS" \
  "$REG_ADDRESS" 2>/dev/null | tail -1)
echo "    contract_address: $HELP_ADDRESS"

# --- 6. Output ---
cat > scripts/deploy-output.json <<EOF
{
  "registry": {
    "address": "$REG_ADDRESS",
    "class_hash": "$REG_CLASS_HASH"
  },
  "helper": {
    "address": "$HELP_ADDRESS",
    "class_hash": "$HELP_CLASS_HASH"
  },
  "pool": "$POOL_ADDRESS",
  "owner": "$OWNER",
  "network": "mainnet"
}
EOF

echo
echo "==> Done. Next steps:"
echo "    1. Open https://gameshield-dapp.vercel.app"
echo "    2. Open Developer settings in the footer"
echo "    3. Paste Registry = $REG_ADDRESS  and Helper = $HELP_ADDRESS"
echo "    4. Click Save"
echo
echo "==> Saved scripts/deploy-output.json with all addresses + class hashes."