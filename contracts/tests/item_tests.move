#[test_only]
module sui_combats::item_tests {
    use sui::test_scenario::{Self as ts};
    use std::string;

    use sui_combats::character::{AdminCap, init_for_testing};
    use sui_combats::item::{Self, Item};

    const PUBLISHER: address = @0xA11CE;

    /// Bootstrap AdminCap for the publisher.
    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, PUBLISHER);
        { init_for_testing(ts::ctx(scenario)); };
    }

    /// Mint a generic uncommon mainhand weapon (helper used by several tests).
    /// v5.1 — passes slot_type=mainhand. Use mint_test_two_handed_weapon for slot_type=2.
    fun mint_test_weapon(
        scenario: &mut ts::Scenario,
        admin: &AdminCap,
        name: vector<u8>,
        level_req: u8,
        attack_bonus: u16,
    ) {
        item::mint_item_admin(
            admin,
            string::utf8(name),
            string::utf8(b"ipfs://test"),
            item::weapon_type(),
            0,                          // class_req
            level_req,
            2,                          // rarity = UNCOMMON (budget 40)
            item::slot_mainhand(),      // v5.1 slot_type
            0, 0, 0, 0,                 // STR, DEX, INT, END bonus
            0, 0, 0, attack_bonus,
            0, 0, 0, 0, 0,
            10, 20,                     // min/max damage
            ts::ctx(scenario),
        );
    }

    // ──────── Happy path ────────

    #[test]
    fun test_mint_item_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            mint_test_weapon(&mut scenario, &admin, b"Iron Sword", 1, 5);
            ts::return_to_sender(&scenario, admin);
        };

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let item = ts::take_from_sender<Item>(&scenario);
            assert!(item::item_type(&item) == item::weapon_type(), 0);
            assert!(item::level_req(&item) == 1, 1);
            assert!(item::attack_bonus(&item) == 5, 2);
            assert!(item::min_damage(&item) == 10, 3);
            assert!(item::max_damage(&item) == 20, 4);
            assert!(item::slot_type(&item) == item::slot_mainhand(), 5);
            ts::return_to_sender(&scenario, item);
        };

        ts::end(scenario);
    }

    // ──────── Error paths ────────

    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::item)]  // EInvalidItemType
    fun test_mint_item_invalid_type() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // item_type = 99 — out of [1, 9] range
            item::mint_item_admin(
                &admin,
                string::utf8(b"Bad"),
                string::utf8(b"ipfs://x"),
                99, 0, 1, 1, 0,           // item_type, class, lvl, rarity, slot_type
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::item)]  // EInvalidRarity
    fun test_mint_item_invalid_rarity() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // rarity = 99 — out of [1, 5] range
            item::mint_item_admin(
                &admin,
                string::utf8(b"Bad"),
                string::utf8(b"ipfs://x"),
                1, 0, 1, 99, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::item)]  // ELevelReqTooHigh
    fun test_mint_item_level_req_too_high() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // level_req = 25 > MAX_LEVEL_REQ (20)
            item::mint_item_admin(
                &admin,
                string::utf8(b"Unusable"),
                string::utf8(b"ipfs://x"),
                1, 0, 25, 1, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::item)]  // EDamageRangeInvalid
    fun test_mint_item_inverted_damage_range() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // min_damage (50) > max_damage (10)
            item::mint_item_admin(
                &admin,
                string::utf8(b"Backwards"),
                string::utf8(b"ipfs://x"),
                1, 0, 1, 1, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                50, 10,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::item)]  // EBonusTooHigh
    fun test_mint_item_bonus_too_high() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // strength_bonus = 1001 > MAX_BONUS (1000). Use UNCOMMON to dodge
            // budget check for this specific abort path.
            item::mint_item_admin(
                &admin,
                string::utf8(b"Cheat"),
                string::utf8(b"ipfs://x"),
                1, 0, 1, 5, 0,             // rarity=LEGENDARY (budget 160) — irrelevant; individual cap fires first
                1001u16, 0, 0, 0,
                0, 0, 0, 0,
                0, 0, 0, 0, 0,
                10, 20,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    // ──────── v5.1 — slot_type validation ────────

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::item)]  // EWeaponSlotTypeInvalid
    fun test_mint_weapon_with_offhand_slot_type_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // Weapon must be mainhand (0) or both_hands (2), NOT offhand (1)
            item::mint_item_admin(
                &admin,
                string::utf8(b"Weird Weapon"),
                string::utf8(b"ipfs://x"),
                item::weapon_type(),
                0, 1, 2,
                item::slot_offhand(),
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                10, 20,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::item)]  // EInvalidSlotType
    fun test_mint_shield_with_mainhand_slot_type_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // Shields must be offhand (1)
            item::mint_item_admin(
                &admin,
                string::utf8(b"Mainhand Shield"),
                string::utf8(b"ipfs://x"),
                item::shield_type(),
                0, 1, 2,
                item::slot_mainhand(),
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::item)]  // EInvalidSlotType
    fun test_mint_helmet_with_nonzero_slot_type_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // Helmets (and all non-weapon/non-shield items) must be slot_type=0
            item::mint_item_admin(
                &admin,
                string::utf8(b"Weird Helmet"),
                string::utf8(b"ipfs://x"),
                item::helmet_type(),
                0, 1, 2,
                item::slot_offhand(),
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_mint_two_handed_weapon_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Greatsword"),
                string::utf8(b"ipfs://x"),
                item::weapon_type(),
                0, 5, 3,                       // RARE (budget 70)
                item::slot_both_hands(),
                0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0,
                30, 50,                        // higher dmg, slot_type=both_hands
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let item = ts::take_from_sender<Item>(&scenario);
            assert!(item::slot_type(&item) == item::slot_both_hands(), 0);
            assert!(item::max_damage(&item) == 50, 1);
            ts::return_to_sender(&scenario, item);
        };

        ts::end(scenario);
    }

    // ──────── v5.1 — Rarity stat budget enforcement ────────

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::item)]  // ERarityBudgetExceeded
    fun test_mint_common_exceeds_budget_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            // COMMON budget = 20. Sum here: 5+5+5+5 + 10 + 20 = 50 > 20.
            // All individual fields under MAX_BONUS (1000) so individual cap passes.
            item::mint_item_admin(
                &admin,
                string::utf8(b"OverBudgetCommon"),
                string::utf8(b"ipfs://x"),
                item::weapon_type(),
                0, 1, 1,                       // COMMON
                item::slot_mainhand(),
                5, 5, 5, 5,                    // 20 in stats
                10, 0, 0, 0, 0, 0, 0, 0, 0,    // +10 hp
                10, 20,                        // dmg adds 20 to sum (max_damage counts)
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_mint_legendary_high_budget_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        bootstrap(&mut scenario);

        // LEGENDARY budget = 160. Sum 20+20+20+10 + 30 + 50 = 150 ≤ 160.
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Godslayer"),
                string::utf8(b"ipfs://x"),
                item::weapon_type(),
                0, 15, 5,                      // LEGENDARY level 15
                item::slot_both_hands(),
                20, 20, 20, 10,
                30, 0, 0, 0, 0, 0, 0, 0, 0,
                20, 50,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_budget_for_rarity_table() {
        assert!(item::budget_for_rarity(1) == 20, 0);    // COMMON
        assert!(item::budget_for_rarity(2) == 40, 1);    // UNCOMMON
        assert!(item::budget_for_rarity(3) == 70, 2);    // RARE
        assert!(item::budget_for_rarity(4) == 110, 3);   // EPIC
        assert!(item::budget_for_rarity(5) == 160, 4);   // LEGENDARY
    }

    // ──────── Slot-type accessor constants ────────

    #[test]
    fun test_slot_type_constants() {
        assert!(item::slot_mainhand() == 0, 0);
        assert!(item::slot_offhand() == 1, 1);
        assert!(item::slot_both_hands() == 2, 2);
    }
}
