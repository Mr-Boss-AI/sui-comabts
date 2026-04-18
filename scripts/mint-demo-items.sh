#!/usr/bin/env bash
#
# One-shot mint script: creates 11 on-chain Item NFTs under the current package
# and transfers them all to Mr_Boss's wallet.
#
# Prereq: active sui CLI address = TREASURY (priceless-turquois).
# Uses the still-unrestricted `item::mint_item` entry function.
# After running this successfully, add the AdminCap gate to mint_item and upgrade.

set -euo pipefail

PACKAGE_ID="0x07fd856dc8db9dc2950f7cc2ef39408bd20414cea86a37477361f5717e188c1d"
MR_BOSS="0xa5ad6e718cfbc50aaaf79f49c9d70b7d3c0f420c3010853872237126bb572498"
BASE_URL="https://gateway.pinata.cloud/ipfs/bafybeie6th7avaepyqcnvkdpo47qjdb6h3azhwvbz55dytekrvfmzdor2y"
RECEIPTS="$(dirname "$0")/mint_receipts.jsonl"

# Item types:  1=WEAPON 2=SHIELD 3=HELMET 4=CHEST 5=GLOVES 6=BOOTS 7=BELT 8=RING 9=NECKLACE
# Rarity:      1=COMMON 2=UNCOMMON 3=RARE 4=EPIC 5=LEGENDARY
# Fields:      name|file|type|classReq|lvl|rarity|str|dex|int|end|hp|armor|def|atk|cc|cm|ev|ac|ae|mind|maxd
#              (cm = crit_multiplier_bonus, in basis points — 10 ≈ +0.10x)
ITEMS=(
  "Rusty Blade|short_rusty_sword.png|1|0|1|1|0|0|0|0|0|0|0|0|0|0|0|0|0|2|4"
  "Iron Longsword|longsword_game.png|1|0|2|2|2|0|0|0|0|0|0|0|0|0|0|0|0|4|7"
  "Steel Greatsword|two_handed_steel_greatsword.png|1|0|5|3|4|0|0|0|0|0|0|0|1|0|0|0|0|8|12"
  "Cursed Greatsword|dark_cursed_greatsword.png|1|0|7|4|6|0|0|0|0|0|0|0|3|10|0|0|0|14|22"
  "Leather Jerkin|simple_leather_chest_armor.png|4|0|1|1|0|0|0|0|5|2|0|0|0|0|0|0|0|0|0"
  "Chainmail Shirt|chainmail.png|4|0|3|2|0|0|0|1|15|6|0|0|0|0|0|0|0|0|0"
  "Mithril Breastplate|ornate_mithril_breastplate.png.png|4|0|5|3|0|0|0|3|30|12|5|0|0|0|0|0|0|0|0"
  "Copper Band|copper_ring.png|8|0|1|1|0|0|1|0|0|0|0|0|0|0|0|0|0|0|0"
  "Silver Signet|silver_signet_ring.png|8|0|3|2|0|0|2|0|0|0|0|0|1|0|0|0|0|0|0"
  "Magic Ring|magical_gold_ring.png|8|0|5|3|0|0|3|0|0|0|0|0|2|0|0|0|0|0|0"
  "Wooden Buckler|wooden_buckler_shield.png|2|0|1|1|0|0|0|0|5|3|0|0|0|0|0|0|0|0|0"
)

echo "==> Active sender: $(sui client active-address)"
echo "==> Recipient:     $MR_BOSS"
echo "==> Items to mint: ${#ITEMS[@]}"
echo

: > "$RECEIPTS"

for entry in "${ITEMS[@]}"; do
  IFS='|' read -r name file type classreq lvl rarity str dex intu end hp armor def atk cc cm ev ac ae mind maxd <<< "$entry"
  url="$BASE_URL/$file"

  echo "---- Mint: $name ----"
  tx_json=$(sui client call \
    --package "$PACKAGE_ID" \
    --module item \
    --function mint_item \
    --args "$name" "$url" "$type" "$classreq" "$lvl" "$rarity" \
           "$str" "$dex" "$intu" "$end" "$hp" "$armor" "$def" "$atk" \
           "$cc" "$cm" "$ev" "$ac" "$ae" "$mind" "$maxd" \
    --gas-budget 50000000 \
    --json)

  item_id=$(echo "$tx_json" | jq -r '.objectChanges[] | select(.type == "created" and (.objectType | contains("::item::Item"))) | .objectId')
  digest=$(echo "$tx_json" | jq -r '.digest // .effects.transactionDigest // "unknown"')

  if [[ -z "$item_id" || "$item_id" == "null" ]]; then
    echo "ERROR: failed to extract item_id from mint tx" >&2
    echo "$tx_json" >&2
    exit 1
  fi

  echo "   item_id: $item_id"
  echo "   tx:      $digest"
  jq -cn --arg name "$name" --arg id "$item_id" --arg url "$url" --arg digest "$digest" \
    '{name: $name, id: $id, image: $url, mint_tx: $digest}' >> "$RECEIPTS"
done

echo
echo "==> All 11 minted. Transferring to Mr_Boss..."
echo

while IFS= read -r line; do
  id=$(echo "$line" | jq -r '.id')
  name=$(echo "$line" | jq -r '.name')
  echo "---- Transfer: $name ($id) ----"
  xfer_json=$(sui client transfer \
    --to "$MR_BOSS" \
    --object-id "$id" \
    --gas-budget 10000000 \
    --json)
  xfer_digest=$(echo "$xfer_json" | jq -r '.digest // .effects.transactionDigest // "unknown"')
  echo "   tx: $xfer_digest"
done < "$RECEIPTS"

echo
echo "==> Done. Receipts: $RECEIPTS"
