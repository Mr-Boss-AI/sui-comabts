#[test_only]
module sui_combats::equipment_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use std::string;

    use sui_combats::character::{
        Self,
        Character,
        AdminCap,
        init_for_testing,
    };
    use sui_combats::item::{Self, Item};
    use sui_combats::equipment;

    const PUBLISHER: address = @0xA11CE;
    const ALICE: address = @0xA;
    const BOB: address = @0xB;

    fun setup_clock(scenario: &mut ts::Scenario): Clock {
        ts::next_tx(scenario, PUBLISHER);
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, 1_700_000_000_000);
        clock
    }

    fun bootstrap_alice(scenario: &mut ts::Scenario): Clock {
        ts::next_tx(scenario, PUBLISHER);
        { init_for_testing(ts::ctx(scenario)); };

        let clock = setup_clock(scenario);

        ts::next_tx(scenario, ALICE);
        {
            character::create_character(
                string::utf8(b"Alice"),
                5, 5, 5, 5,
                &clock,
                ts::ctx(scenario),
            );
        };

        clock
    }

    /// Mint a weapon and transfer to ALICE.
    fun mint_weapon_to_alice(scenario: &mut ts::Scenario, level_req: u8) {
        ts::next_tx(scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Sword"),
                string::utf8(b"ipfs://sword"),
                item::weapon_type(),
                0, level_req, 2,
                0, 0, 0, 0, 0, 0, 0, 5,
                0, 0, 0, 0, 0,
                10, 20,
                ts::ctx(scenario),
            );
            ts::return_to_sender(scenario, admin);
        };

        ts::next_tx(scenario, PUBLISHER);
        {
            let item = ts::take_from_sender<Item>(scenario);
            sui::transfer::public_transfer(item, ALICE);
        };
    }

    // ──────── Equip happy path ────────

    #[test]
    fun test_equip_unequip_weapon_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_weapon_to_alice(&mut scenario, 1);

        // ALICE equips
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        // ALICE unequips — item returns to her inventory
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::unequip_weapon(&mut c, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        // Verify item returned
        ts::next_tx(&mut scenario, ALICE);
        {
            let item = ts::take_from_sender<Item>(&scenario);
            assert!(item::item_type(&item) == item::weapon_type(), 0);
            ts::return_to_sender(&scenario, item);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Owner check ────────

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::equipment)]  // ENotOwner
    fun test_equip_non_owner_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_weapon_to_alice(&mut scenario, 1);

        // BOB takes ALICE's item (simulating cross-wallet wrap) and tries to equip
        // — owner check rejects.
        ts::next_tx(&mut scenario, ALICE);
        {
            let item = ts::take_from_sender<Item>(&scenario);
            sui::transfer::public_transfer(item, BOB);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Wrong item type ────────

    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::equipment)]  // EWrongItemType
    fun test_equip_wrong_type_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);

        // Mint a HELMET, then try to put it in the WEAPON slot
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Helm"),
                string::utf8(b"ipfs://helm"),
                item::helmet_type(),
                0, 1, 2,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let helm = ts::take_from_sender<Item>(&scenario);
            sui::transfer::public_transfer(helm, ALICE);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let helm = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, helm, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Fight-lock ────────

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::equipment)]  // EFightLocked
    fun test_equip_during_fight_lock_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_weapon_to_alice(&mut scenario, 1);

        // PUBLISHER sets fight-lock
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            let now = clock::timestamp_ms(&clock);
            character::set_fight_lock(&admin, &mut c, now + 100_000, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        // ALICE tries to equip mid-fight
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Level requirement ────────

    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::equipment)]  // ELevelTooLow
    fun test_equip_level_too_low_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        // mint level-5 weapon — ALICE is level 1
        mint_weapon_to_alice(&mut scenario, 5);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Slot occupied ────────

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::equipment)]  // ESlotOccupied
    fun test_equip_slot_occupied_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_weapon_to_alice(&mut scenario, 1);

        // Mint second weapon
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Sword2"),
                string::utf8(b"ipfs://sword2"),
                item::weapon_type(),
                0, 1, 2,
                0, 0, 0, 0, 0, 0, 0, 5,
                0, 0, 0, 0, 0,
                10, 20,
                ts::ctx(&mut scenario),
            );
            ts::return_to_sender(&scenario, admin);
        };
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let item2 = ts::take_from_sender<Item>(&scenario);
            sui::transfer::public_transfer(item2, ALICE);
        };

        // First weapon equips OK
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        // Second weapon collides
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item2 = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item2, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── save_loadout ────────

    #[test]
    fun test_save_loadout_increments_version() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);

        // Initially version = 0
        ts::next_tx(&mut scenario, ALICE);
        {
            let c = ts::take_shared<Character>(&scenario);
            assert!(character::loadout_version(&c) == 0, 0);
            ts::return_shared(c);
        };

        // First save
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::save_loadout(&mut c, ts::ctx(&mut scenario));
            assert!(character::loadout_version(&c) == 1, 1);
            ts::return_shared(c);
        };

        // Second save
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::save_loadout(&mut c, ts::ctx(&mut scenario));
            assert!(character::loadout_version(&c) == 2, 2);
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::equipment)]  // ENotOwner
    fun test_save_loadout_non_owner_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::save_loadout(&mut c, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
