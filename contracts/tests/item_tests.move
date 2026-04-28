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

    /// Mint a generic uncommon weapon (helper used by several tests).
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
            0,           // class_req
            level_req,
            2,           // rarity = UNCOMMON
            0, 0, 0, 0,  // STR, DEX, INT, END bonus
            0, 0, 0, attack_bonus,
            0, 0, 0, 0, 0,
            10, 20,      // min/max damage
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
                99, 0, 1, 1,
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
                1, 0, 1, 99,
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
                1, 0, 25, 1,
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
                1, 0, 1, 1,
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
            // strength_bonus = 9999 > MAX_BONUS (1000)
            item::mint_item_admin(
                &admin,
                string::utf8(b"Cheat"),
                string::utf8(b"ipfs://x"),
                1, 0, 1, 1,
                9999, 0, 0, 0,
                0, 0, 0, 0,
                0, 0, 0, 0, 0,
                10, 20,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };

        ts::end(scenario);
    }

}
