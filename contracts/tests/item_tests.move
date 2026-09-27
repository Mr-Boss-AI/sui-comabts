#[test_only]
module sui_combats::item_tests {
    use sui::test_scenario::{Self as ts};
    use std::string;

    use sui_combats::character::{AdminCap, init_for_testing};
    use sui_combats::item::{Self, Item};

    const PUBLISHER: address = @0xA11CE;

    // Stat vector order (13): STR, DEX, INT, END, HP, ARM, DEF, ATK,
    // CRIT%, CRITDMG, EVA%, ANTICRIT%, ANTIEVA%.
    fun mint(
        item_type: u8,
        level_req: u8,
        slot_type: u8,
        s: vector<u16>,
        min_damage: u16,
        max_damage: u16,
    ) {
        let mut scenario = ts::begin(PUBLISHER);
        init_for_testing(ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Test Item"),
                string::utf8(b"ipfs://test"),
                item_type, 0, level_req, slot_type,
                s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], s[12],
                min_damage, max_damage,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };
        ts::end(scenario);
    }

    fun zero(): vector<u16> { vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
    fun one_stat(idx: u64, v: u16): vector<u16> { let mut s = zero(); *&mut s[idx] = v; s }

    // ──────── Happy path ────────

    #[test]
    fun test_mint_item_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        init_for_testing(ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Iron Sword"),
                string::utf8(b"ipfs://test"),
                item::weapon_type(), 0, 5, item::slot_mainhand(),
                0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
                2, 4,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let item = ts::take_from_sender<Item>(&scenario);
            assert!(item::item_type(&item) == item::weapon_type(), 0);
            assert!(item::level_req(&item) == 5, 1);
            assert!(item::attack_bonus(&item) == 1, 2);
            assert!(item::min_damage(&item) == 2, 3);
            assert!(item::max_damage(&item) == 4, 4);
            assert!(item::slot_type(&item) == item::slot_mainhand(), 5);
            ts::return_to_sender(&scenario, item);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_mint_two_handed_weapon_happy() {
        let mut s = zero();
        *&mut s[0] = 2;                                          // STR +2
        mint(item::weapon_type(), 10, item::slot_both_hands(), s, 5, 9);
    }

    // ──────── Shape / range errors ────────

    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::item)]  // EInvalidItemType
    fun test_mint_item_invalid_type() { mint(99, 5, 0, zero(), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::item)] // ELevelReqZero
    fun test_mint_item_level_req_zero() { mint(item::helmet_type(), 0, 0, zero(), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::item)]  // ELevelReqTooHigh
    fun test_mint_item_level_req_too_high() { mint(item::helmet_type(), 25, 0, zero(), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::item)]  // EDamageRangeInvalid
    fun test_mint_item_inverted_damage_range() { mint(item::weapon_type(), 5, 0, zero(), 5, 2); }

    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::item)]  // EBonusTooHigh
    fun test_mint_item_bonus_too_high() { mint(item::helmet_type(), 20, 0, one_stat(4, 1001), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::item)]  // EWeaponSlotTypeInvalid
    fun test_mint_weapon_with_offhand_slot_type_aborts() { mint(item::weapon_type(), 5, item::slot_offhand(), zero(), 1, 2); }

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::item)]  // EInvalidSlotType
    fun test_mint_shield_with_mainhand_slot_type_aborts() { mint(item::shield_type(), 5, item::slot_mainhand(), zero(), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::item)]  // EInvalidSlotType
    fun test_mint_helmet_with_nonzero_slot_type_aborts() { mint(item::helmet_type(), 5, item::slot_offhand(), zero(), 0, 0); }

    // ──────── v5.3 weapon / shield level rule ────────

    #[test]
    #[expected_failure(abort_code = 9, location = sui_combats::item)]  // EHandItemLevelTooLow
    fun test_weapon_at_level_2_aborts() { mint(item::weapon_type(), 2, item::slot_mainhand(), zero(), 1, 1); }

    #[test]
    #[expected_failure(abort_code = 9, location = sui_combats::item)]
    fun test_shield_at_level_2_aborts() { mint(item::shield_type(), 2, item::slot_offhand(), zero(), 0, 0); }

    #[test]
    fun test_weapon_and_shield_at_level_3_ok() {
        mint(item::weapon_type(), 3, item::slot_mainhand(), zero(), 1, 2);
        mint(item::shield_type(), 3, item::slot_offhand(), one_stat(5, 1), 0, 0);
    }

    #[test]
    fun test_helmet_at_level_1_ok() { mint(item::helmet_type(), 1, 0, one_stat(4, 3), 0, 0); }

    // ──────── v5.3 flat power limit ────────

    #[test]
    fun test_max_flat_power_table() {
        assert!(item::max_flat_power(1) == 15, 0);
        assert!(item::max_flat_power(5) == 45, 1);
        assert!(item::max_flat_power(10) == 104, 2);
        assert!(item::max_flat_power(20) == 294, 3);
    }

    #[test]
    fun test_flat_power_weights() {
        // HP 1, ARM 7, DEF 7, ATK 7, max_damage 6, STR 5, DEX 3, END 7
        assert!(item::flat_power(1, 0, 0, 0, 0, 0, 0, 0) == 5, 0);
        assert!(item::flat_power(0, 1, 0, 0, 0, 0, 0, 0) == 3, 1);
        assert!(item::flat_power(0, 0, 1, 0, 0, 0, 0, 0) == 7, 2);
        assert!(item::flat_power(0, 0, 0, 1, 0, 0, 0, 0) == 1, 3);
        assert!(item::flat_power(0, 0, 0, 0, 1, 0, 0, 0) == 7, 4);
        assert!(item::flat_power(0, 0, 0, 0, 0, 1, 0, 0) == 7, 5);
        assert!(item::flat_power(0, 0, 0, 0, 0, 0, 1, 0) == 7, 6);
        assert!(item::flat_power(0, 0, 0, 0, 0, 0, 0, 1) == 6, 7);
    }

    #[test]
    fun test_level_1_hp_at_limit_ok() { mint(item::helmet_type(), 1, 0, one_stat(4, 15), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::item)]  // EPowerBudgetExceeded
    fun test_level_1_hp_over_limit_aborts() { mint(item::helmet_type(), 1, 0, one_stat(4, 16), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::item)]
    fun test_level_1_armor_100_aborts() { mint(item::chest_type(), 1, 0, one_stat(5, 100), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::item)]
    fun test_level_3_weapon_huge_damage_aborts() { mint(item::weapon_type(), 3, item::slot_mainhand(), zero(), 10, 20); }

    #[test]
    fun test_level_20_chest_ok() {
        let mut s = zero();
        *&mut s[4] = 60;   // HP +60
        *&mut s[5] = 10;   // ARM +10
        mint(item::chest_type(), 20, 0, s, 0, 0);   // 60 + 70 = 130 ≤ 294
    }

    // ──────── v5.3 chance points ────────

    #[test]
    fun test_chance_points_weights() {
        // INT ×2, crit %, crit dmg ÷10, evasion %, anti-crit %, anti-evasion %
        assert!(item::chance_points(1, 0, 0, 0, 0, 0) == 2, 0);
        assert!(item::chance_points(0, 1, 0, 0, 0, 0) == 1, 1);
        assert!(item::chance_points(0, 0, 10, 0, 0, 0) == 1, 2);
        assert!(item::chance_points(0, 0, 0, 1, 1, 1) == 3, 3);
        assert!(item::max_chance_points() == 20, 4);
    }

    #[test]
    fun test_ring_int_10_at_limit_ok() { mint(item::ring_type(), 1, 0, one_stat(2, 10), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 10, location = sui_combats::item)] // EChancePointsExceeded
    fun test_ring_crit_21_aborts() { mint(item::ring_type(), 20, 0, one_stat(8, 21), 0, 0); }

    #[test]
    #[expected_failure(abort_code = 10, location = sui_combats::item)]
    fun test_necklace_mixed_chance_over_limit_aborts() {
        let mut s = zero();
        *&mut s[8] = 8;    // crit 8
        *&mut s[10] = 8;   // evasion 8
        *&mut s[11] = 5;   // anti-crit 5  → 21
        mint(item::necklace_type(), 20, 0, s, 0, 0);
    }

    // ──────── Slot-type accessor constants ────────

    #[test]
    fun test_slot_type_constants() {
        assert!(item::slot_mainhand() == 0, 0);
        assert!(item::slot_offhand() == 1, 1);
        assert!(item::slot_both_hands() == 2, 2);
        assert!(item::min_hand_item_level() == 3, 3);
    }
}
