#[test_only]
module sui_combats::equipment_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use std::string;

    use sui_combats::character::{
        Self,
        Character,
        CharacterRegistry,
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
            let mut registry = ts::take_shared<CharacterRegistry>(scenario);
            character::create_character(
                string::utf8(b"Alice"),
                5, 5, 5, 5,
                &mut registry,
                &clock,
                ts::ctx(scenario),
            );
            ts::return_shared(registry);
        };

        clock
    }

    /// Mint a mainhand weapon and transfer to ALICE.
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
                item::slot_mainhand(),
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

    /// v5.1 — Mint a TWO-HANDED weapon (slot_type=2) to ALICE.
    fun mint_two_handed_weapon_to_alice(scenario: &mut ts::Scenario, level_req: u8) {
        ts::next_tx(scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Greatsword"),
                string::utf8(b"ipfs://greatsword"),
                item::weapon_type(),
                0, level_req, 3,                     // RARE
                item::slot_both_hands(),
                0, 0, 0, 0, 0, 0, 0, 5,
                0, 0, 0, 0, 0,
                25, 40,
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

    /// v5.1 — Mint a SHIELD (offhand) to ALICE.
    fun mint_shield_to_alice(scenario: &mut ts::Scenario, level_req: u8) {
        ts::next_tx(scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Buckler"),
                string::utf8(b"ipfs://shield"),
                item::shield_type(),
                0, level_req, 2,
                item::slot_offhand(),
                0, 0, 0, 0, 0, 5, 0, 0,
                0, 0, 0, 0, 0,
                0, 0,
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

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::unequip_weapon(&mut c, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

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

        // Mint a HELMET (slot_type=0 mainhand, per shape rules for non-weapon
        // non-shield items), then try to put it in the WEAPON slot.
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Helm"),
                string::utf8(b"ipfs://helm"),
                item::helmet_type(),
                0, 1, 2,
                item::slot_mainhand(),
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

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            let now = clock::timestamp_ms(&clock);
            character::set_fight_lock(&admin, &mut c, now + 100_000, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

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

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(b"Sword2"),
                string::utf8(b"ipfs://sword2"),
                item::weapon_type(),
                0, 1, 2,
                item::slot_mainhand(),
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

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, item, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

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

        ts::next_tx(&mut scenario, ALICE);
        {
            let c = ts::take_shared<Character>(&scenario);
            assert!(character::loadout_version(&c) == 0, 0);
            ts::return_shared(c);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::save_loadout(&mut c, ts::ctx(&mut scenario));
            assert!(character::loadout_version(&c) == 1, 1);
            ts::return_shared(c);
        };

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

    // ──────── v5.1 — Two-handed weapon enforcement ────────

    #[test]
    fun test_equip_two_handed_weapon_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_two_handed_weapon_to_alice(&mut scenario, 1);

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

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::equipment)]  // EOffhandOccupied
    fun test_equip_two_handed_with_offhand_occupied_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_shield_to_alice(&mut scenario, 1);
        mint_two_handed_weapon_to_alice(&mut scenario, 1);

        // Equip the shield in offhand first.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            // Both items are owned by ALICE — take the shield by type
            // (shield was minted first). Since both are Item, we take and
            // check which is which.
            let item1 = ts::take_from_sender<Item>(&scenario);
            let item2 = ts::take_from_sender<Item>(&scenario);
            // The two-handed weapon has item_type == WEAPON; shield is SHIELD.
            let (shield, twoh) = if (item::item_type(&item1) == item::shield_type()) {
                (item1, item2)
            } else {
                (item2, item1)
            };
            equipment::equip_offhand(&mut c, shield, &clock, ts::ctx(&mut scenario));
            // Now equip the two-handed weapon — should abort EOffhandOccupied.
            equipment::equip_weapon(&mut c, twoh, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::equipment)]  // EWeaponIsTwoHanded
    fun test_equip_offhand_after_two_handed_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_two_handed_weapon_to_alice(&mut scenario, 1);
        mint_shield_to_alice(&mut scenario, 1);

        // Equip two-handed weapon first.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item1 = ts::take_from_sender<Item>(&scenario);
            let item2 = ts::take_from_sender<Item>(&scenario);
            let (twoh, shield) = if (item::item_type(&item1) == item::weapon_type()) {
                (item1, item2)
            } else {
                (item2, item1)
            };
            equipment::equip_weapon(&mut c, twoh, &clock, ts::ctx(&mut scenario));
            // Now attempting to equip an offhand should abort EWeaponIsTwoHanded.
            equipment::equip_offhand(&mut c, shield, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_equip_offhand_with_mainhand_weapon_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_weapon_to_alice(&mut scenario, 1);
        mint_shield_to_alice(&mut scenario, 1);

        // Mainhand weapon + offhand shield — happy path.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let item1 = ts::take_from_sender<Item>(&scenario);
            let item2 = ts::take_from_sender<Item>(&scenario);
            let (weapon, shield) = if (item::item_type(&item1) == item::weapon_type()) {
                (item1, item2)
            } else {
                (item2, item1)
            };
            equipment::equip_weapon(&mut c, weapon, &clock, ts::ctx(&mut scenario));
            equipment::equip_offhand(&mut c, shield, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 (2026-05-28 PM) — 3 new slots: pants, bracelets, pauldrons ────────

    /// Helper — mint an item of arbitrary `item_type` and slot_type=mainhand
    /// (which the contract requires for all non-weapon/non-shield items per v5.1
    /// shape validation). Transfers to ALICE.
    fun mint_misc_to_alice(
        scenario: &mut ts::Scenario,
        item_type: u8,
        level_req: u8,
        rarity: u8,
        name_bytes: vector<u8>,
    ) {
        ts::next_tx(scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(scenario);
            item::mint_item_admin(
                &admin,
                string::utf8(name_bytes),
                string::utf8(b"ipfs://misc"),
                item_type,
                0, level_req, rarity,
                item::slot_mainhand(),
                0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0,
                0, 0,
                ts::ctx(scenario),
            );
            ts::return_to_sender(scenario, admin);
        };
        ts::next_tx(scenario, PUBLISHER);
        {
            let it = ts::take_from_sender<Item>(scenario);
            sui::transfer::public_transfer(it, ALICE);
        };
    }

    #[test]
    fun test_equip_unequip_pants_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_misc_to_alice(&mut scenario, item::pants_type(), 1, 2, b"Greaves");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let pants = ts::take_from_sender<Item>(&scenario);
            equipment::equip_pants(&mut c, pants, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::unequip_pants(&mut c, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_equip_unequip_bracelets_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_misc_to_alice(&mut scenario, item::bracelets_type(), 1, 2, b"Wraps");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let br = ts::take_from_sender<Item>(&scenario);
            equipment::equip_bracelets(&mut c, br, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::unequip_bracelets(&mut c, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_equip_unequip_pauldrons_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_misc_to_alice(&mut scenario, item::pauldrons_type(), 1, 2, b"Spaulders");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let p = ts::take_from_sender<Item>(&scenario);
            equipment::equip_pauldrons(&mut c, p, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            equipment::unequip_pauldrons(&mut c, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::equipment)]  // EWrongItemType
    fun test_equip_pants_with_helmet_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_misc_to_alice(&mut scenario, item::helmet_type(), 1, 2, b"Helm");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let helm = ts::take_from_sender<Item>(&scenario);
            equipment::equip_pants(&mut c, helm, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::equipment)]  // ESlotOccupied
    fun test_equip_bracelets_slot_occupied_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_misc_to_alice(&mut scenario, item::bracelets_type(), 1, 2, b"Br1");
        mint_misc_to_alice(&mut scenario, item::bracelets_type(), 1, 2, b"Br2");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let b1 = ts::take_from_sender<Item>(&scenario);
            equipment::equip_bracelets(&mut c, b1, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let b2 = ts::take_from_sender<Item>(&scenario);
            equipment::equip_bracelets(&mut c, b2, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::equipment)]  // ELevelTooLow
    fun test_equip_pauldrons_level_too_low_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        // Level-15 pauldrons; ALICE is level 1.
        mint_misc_to_alice(&mut scenario, item::pauldrons_type(), 15, 4, b"Epic");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let p = ts::take_from_sender<Item>(&scenario);
            equipment::equip_pauldrons(&mut c, p, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::equipment)]  // EFightLocked
    fun test_equip_pants_during_fight_lock_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_misc_to_alice(&mut scenario, item::pants_type(), 1, 2, b"P");

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            let now = clock::timestamp_ms(&clock);
            character::set_fight_lock(&admin, &mut c, now + 100_000, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let p = ts::take_from_sender<Item>(&scenario);
            equipment::equip_pants(&mut c, p, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_dual_wield_two_mainhand_weapons_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap_alice(&mut scenario);
        mint_weapon_to_alice(&mut scenario, 1);
        mint_weapon_to_alice(&mut scenario, 1);

        // Two single-hand weapons — dual-wield.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            let w1 = ts::take_from_sender<Item>(&scenario);
            let w2 = ts::take_from_sender<Item>(&scenario);
            equipment::equip_weapon(&mut c, w1, &clock, ts::ctx(&mut scenario));
            equipment::equip_offhand(&mut c, w2, &clock, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
