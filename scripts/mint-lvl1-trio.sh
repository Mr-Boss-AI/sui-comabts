#!/usr/bin/env bash
#
# One-off: mint 3 level-1 items (Rusty Blade, Leather Jerkin, Copper Band)
# to Mr_Boss's wallet, using mint_item_admin on the upgraded package.
#
# Prereq: active sui CLI = TREASURY (holds AdminCap).
# Appends new receipts to scripts/mint_receipts.jsonl.

set -euo pipefail

# Upgraded package — mint_item on original pkg is deprecated and aborts
CALL_PACKAGE="0x5f9011c8eb31f321fbd5b2ad5c811f34011a96a4c8a2ddfc6262727dee55c76b"
ADMIN_CAP="0xff993e6ded3683762b3ed04d1e7dbe2e7a1373f3de9ddc52ed762b3c18ca9505"
MR_BOSS="0xa5ad6e718cfbc50aaaf79f49c9d70b7d3c0f420c3010853872237126bb572498"
BASE_URL="https://gateway.pinata.cloud/ipfs/bafybeie6th7avaepyqcnvkdpo47qjdb6h3azhwvbz55dytekrvfmzdor2y"
RECEIPTS="$(dirname "$0")/mint_receipts.jsonl"

# Fields: name|file|type|classReq|lvl|rarity|str|dex|int|end|hp|armor|def|atk|cc|cm|ev|ac|ae|mind|maxd
# Values identical to yesterday's originals per mint_receipts.jsonl entries 1/5/8.
ITEMS=(
  "Rusty Blade|short_rusty_sword.png|1|0|1|1|0|0|0|0|0|0|0|0|0|0|0|0|0|2|4"
  "Leather Jerkin|simple_leather_chest_armor.png|4|0|1|1|0|0|0|0|5|2|0|0|0|0|0|0|0|0|0"
  "Copper Band|copper_ring.png|8|0|1|1|0|0|1|0|0|0|0|0|0|0|0|0|0|0|0"
)

active=$(sui client active-address)
echo "==> Active sender: $active"
echo "==> Recipient:     $MR_BOSS"
echo "==> Package:       $CALL_PACKAGE (upgraded)"
echo "==> Items to mint: ${#ITEMS[@]}"
echo

declare -a MINTED_IDS
declare -a MINTED_NAMES

for entry in "${ITEMS[@]}"; do
  IFS='|' read -r name file type classreq lvl rarity str dex intu end hp armor def atk cc cm ev ac ae mind maxd <<< "$entry"
  url="$BASE_URL/$file"

  echo "---- Mint: $name ----"
  tx_json=$(sui client call \
    --package "$CALL_PACKAGE" \
    --module item \
    --function mint_item_admin \
    --args "$ADMIN_CAP" "$name" "$url" "$type" "$classreq" "$lvl" "$rarity" \
           "$str" "$dex" "$intu" "$end" "$hp" "$armor" "$def" "$atk" \
           "$cc" "$cm" "$ev" "$ac" "$ae" "$mind" "$maxd" \
    --gas-budget 50000000 \
    --json)

  item_id=$(echo "$tx_json" | jq -r '.objectChanges[] | select(.type == "created" and (.objectType | contains("::item::Item"))) | .objectId')
  digest=$(echo "$tx_json" | jq -r '.digest // .effects.transactionDigest // "unknown"')

  if [[ -z "$item_id" || "$item_id" == "null" ]]; then
    echo "ERROR: could not extract item_id for $name" >&2
    echo "$tx_json" | jq '.effects.status, .errors' >&2
    exit 1
  fi

  echo "   item_id: $item_id"
  echo "   tx:      $digest"

  jq -cn --arg name "$name" --arg id "$item_id" --arg url "$url" --arg digest "$digest" \
    '{name: $name, id: $id, image: $url, mint_tx: $digest}' >> "$RECEIPTS"

  MINTED_IDS+=("$item_id")
  MINTED_NAMES+=("$name")
done

echo
echo "==> Transferring ${#MINTED_IDS[@]} items to Mr_Boss..."
echo

for i in "${!MINTED_IDS[@]}"; do
  id="${MINTED_IDS[$i]}"
  name="${MINTED_NAMES[$i]}"
  echo "---- Transfer: $name ($id) ----"
  xfer_json=$(sui client transfer \
    --to "$MR_BOSS" \
    --object-id "$id" \
    --gas-budget 10000000 \
    --json)
  xfer_digest=$(echo "$xfer_json" | jq -r '.digest // .effects.transactionDigest // "unknown"')
  echo "   tx: $xfer_digest"
done

echo
echo "==> Done. Receipts appended to $RECEIPTS"
