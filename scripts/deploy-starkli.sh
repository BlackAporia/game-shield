#!/usr/bin/env bash
# deploy-starkli.sh — deploy GameShield v5 contracts using starkli CLI
# (bypasses the Ready X fee-review issue with unknown custom contracts).
#
# Auto-detects the machine's existing starkli config:
#   ~/.starkli-gs/account.json  +  ~/.starkli-gs/keystore.json
# (or use STARKNET_ACCOUNT / STARKNET_KEYSTORE / STARKNET_PRIVATE_KEY).
#
# Usage:
#   OWNER_ADDRESS=<your address> bash scripts/deploy-starkli.sh
#
#   If OWNER_ADDRESS is omitted, it is read from the account config file.
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

# --- 0. starkli account / signer config -------------------------------------
if [[ -z "${STARKNET_ACCOUNT:-}" && -f "$HOME/.starkli-gs/account.json" ]]; then
  export STARKNET_ACCOUNT="$HOME/.starkli-gs/account.json"
  echo "==> Using starkli account: $STARKNET_ACCOUNT"
fi
if [[ -z "${STARKNET_KEYSTORE:-}" && -f "$HOME/.starkli-gs/keystore.json" ]]; then
  export STARKNET_KEYSTORE="$HOME/.starkli-gs/keystore.json"
  echo "==> Using starkli keystore: $STARKNET_KEYSTORE"
fi
if [[ -z "${STARKNET_ACCOUNT:-}" ]]; then
  echo "ERROR: starkli account not configured." >&2
  echo "       Set STARKNET_ACCOUNT=<path to account.json>, or create one:" >&2
  echo "         starkli account oz init ~/.starkli-gs/account.json" >&2
  exit 1
fi
if [[ -z "${STARKNET_KEYSTORE:-}" && -z "${STARKNET_PRIVATE_KEY:-}" ]]; then
  echo "ERROR: starkli signer not configured. Set STARKNET_KEYSTORE or STARKNET_PRIVATE_KEY." >&2
  exit 1
fi
if [[ -z "${STARKNET_KEYSTORE_PASSWORD:-}" && -f "${STARKNET_KEYSTORE:-}" ]]; then
  read -r -s -p "Enter starkli keystore password: " STARKNET_KEYSTORE_PASSWORD
  echo
  export STARKNET_KEYSTORE_PASSWORD
fi

# --- Owner address -----------------------------------------------------------
if [[ -n "${OWNER_ADDRESS:-}" ]]; then
  OWNER="$OWNER_ADDRESS"
elif python3 -c "import json,sys; json.load(open('$STARKNET_ACCOUNT'))['deployment']['address']" 2>/dev/null; then
  OWNER=$(python3 -c "import json; print(json.load(open('$STARKNET_ACCOUNT'))['deployment']['address'])")
else
  echo "ERROR: OWNER_ADDRESS not set and could not read it from $STARKNET_ACCOUNT" >&2
  exit 1
fi
echo "    owner: $OWNER"

# --- Helpers -----------------------------------------------------------------
ERR_FILE="$(mktemp /tmp/gs-deploy.XXXXXX.err)"
trap 'rm -f "$ERR_FILE"' EXIT

starkli_ok() { # starkli_ok <cmd...> ; prints stdout last line, exits on failure
  local out rc
  out=$(starkli "$@" 2>"$ERR_FILE")
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "ERROR: starkli $* failed (exit $rc):" >&2
    sed 's/^/    /' "$ERR_FILE" >&2
    exit 1
  fi
  printf '%s\n' "$out" | tail -1
}

declare_class() { # declare_class <sierra> <casm> ; prints class hash
  local sierra=$1 casm=$2 out rc
  out=$(starkli declare "$sierra" --casm-file "$casm" --rpc "$RPC_URL" 2>"$ERR_FILE")
  rc=$?
  if [[ $rc -ne 0 ]]; then
    if grep -qi "already declared" "$ERR_FILE"; then
      starkli class-hash "$sierra" 2>/dev/null | tail -1
      return 0
    fi
    echo "ERROR: starkli declare failed (exit $rc):" >&2
    sed 's/^/    /' "$ERR_FILE" >&2
    exit 1
  fi
  printf '%s\n' "$out" | tail -1
}

# --- 1. Build -----------------------------------------------------------------
echo "==> Building contracts with scarb"
(cd contracts && scarb build)

# --- 2. Declare + deploy registry --------------------------------------------
echo "==> Declaring CampaignRegistry"
REG_CLASS_HASH=$(declare_class \
  contracts/target/dev/gameshield_CampaignRegistry.contract_class.json \
  contracts/target/dev/gameshield_CampaignRegistry.compiled_contract_class.json)
echo "    class_hash: $REG_CLASS_HASH"

echo "==> Deploying CampaignRegistry (owner = $OWNER)"
REG_ADDRESS=$(starkli_ok deploy "$REG_CLASS_HASH" --rpc "$RPC_URL" "$OWNER")
echo "    contract_address: $REG_ADDRESS"

# --- 3. Declare + deploy helper ----------------------------------------------
echo "==> Declaring PayoutHelper"
HELP_CLASS_HASH=$(declare_class \
  contracts/target/dev/gameshield_PayoutHelper.contract_class.json \
  contracts/target/dev/gameshield_PayoutHelper.compiled_contract_class.json)
echo "    class_hash: $HELP_CLASS_HASH"

echo "==> Deploying PayoutHelper (pool + registry)"
HELP_ADDRESS=$(starkli_ok deploy "$HELP_CLASS_HASH" --rpc "$RPC_URL" "$POOL_ADDRESS" "$REG_ADDRESS")
echo "    contract_address: $HELP_ADDRESS"

# --- 4. Output -----------------------------------------------------------------
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