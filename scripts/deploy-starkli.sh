#!/usr/bin/env bash
# deploy-starkli.sh — deploy GameShield v5 contracts using starkli CLI
# (bypasses the Ready X fee-review issue with unknown custom contracts).
#
# Prerequisites:
#   - starkli 0.4+ (https://book.starkli.rs/installation)
#   - A keystore.json or private-key var configured for your account.
#     See: https://book.starkli.rs/signers
#   - scarb 2.18+ to build contracts.
#
# Usage:
#   bash scripts/deploy-starkli.sh
#
# Output:
#   Writes scripts/deploy-output.json with the deployed addresses and
#   class hashes. Paste those into the dapp's Developer settings → Save.
#
# Environment (optional overrides):
#   POOL_ADDRESS         - STRK20 pool (default: 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
#   OWNER_ADDRESS        - account that will own the registry (default: $STARKNET_ACCOUNT)
#   RPC_URL              - mainnet RPC (default: https://rpc.starknet.lava.build)

set -euo pipefail

cd "$(dirname "$0")/.."

# --- 1. Build ---
echo "==> Building contracts with scarb"
scarb build

# --- 2. Inputs ---
POOL_ADDRESS="${POOL_ADDRESS:-0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a}"
STARKNET_NETWORK="${STARKNET_NETWORK:-mainnet}"
RPC_URL="${RPC_URL:-https://rpc.starknet.lava.build}"
STARKNET_RPC="$RPC_URL"
export STARKNET_NETWORK
export STARKNET_RPC

if [[ -z "${OWNER_ADDRESS:-${STARKNET_ACCOUNT:-}}" ]]; then
  echo "ERROR: OWNER_ADDRESS (or STARKNET_ACCOUNT) env var is required — the registry owner."
  exit 1
fi
OWNER="${OWNER_ADDRESS:-${STARKNET_ACCOUNT}}"

# --- 3. Declare registry ---
echo "==> Declaring CampaignRegistry"
REG_DECLARE_JSON=$(starkli declare \
  contracts/target/dev/gameshield_CampaignRegistry.contract_class.json \
  --rpc "$RPC_URL")
REG_CLASS_HASH=$(echo "$REG_DECLARE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['class_hash'])")
REG_DECLARE_TX=$(echo "$REG_DECLARE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['transaction_hash'])")
echo "    class_hash:  $REG_CLASS_HASH"
echo "    declare_tx:  $REG_DECLARE_TX"

# --- 4. Deploy registry ---
echo "==> Deploying CampaignRegistry (owner = $OWNER)"
REG_DEPLOY_JSON=$(starkli deploy "$REG_CLASS_HASH" \
  --rpc "$RPC_URL" \
  "$OWNER")
REG_ADDRESS=$(echo "$REG_DEPLOY_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['contract_address'])")
echo "    contract_address: $REG_ADDRESS"

# --- 5. Declare helper ---
echo "==> Declaring PayoutHelper"
HELP_DECLARE_JSON=$(starkli declare \
  contracts/target/dev/gameshield_PayoutHelper.contract_class.json \
  --rpc "$RPC_URL")
HELP_CLASS_HASH=$(echo "$HELP_DECLARE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['class_hash'])")
echo "    class_hash:  $HELP_CLASS_HASH"

# --- 6. Deploy helper ---
echo "==> Deploying PayoutHelper (pool + registry)"
HELP_DEPLOY_JSON=$(starkli deploy "$HELP_CLASS_HASH" \
  --rpc "$RPC_URL" \
  "$POOL_ADDRESS" \
  "$REG_ADDRESS")
HELP_ADDRESS=$(echo "$HELP_DEPLOY_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['contract_address'])")
echo "    contract_address: $HELP_ADDRESS"

# --- 7. Output ---
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
  "network": "$STARKNET_NETWORK"
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
