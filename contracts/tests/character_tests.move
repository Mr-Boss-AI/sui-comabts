#[test_only]
module sui_combats::character_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use std::string;

    use sui_combats::character::{
        Self,
        Character,
        CharacterRegistry,
        AdminCap,
        init_for_testing,
        xp_for_level_for_testing,
    };

    const PUBLISHER: address = @0xA11CE;
    const ALICE: address = @0xA;
    const BOB: address = @0xB;

    // ──────── Helpers ────────

    fun setup_clock(scenario: &mut ts::Scenario, starting_ms: u64): Clock {
        ts::next_tx(scenario, PUBLISHER);
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, starting_ms);
        clock
    }

    /// Boot AdminCap + CharacterRegistry, then mint one shared Character owned by ALICE.
    fun bootstrap(scenario: &mut ts::Scenario): Clock {
        ts::next_tx(scenario, PUBLISHER);
        { init_for_testing(ts::ctx(scenario)); };

        let clock = setup_clock(scenario, 1_700_000_000_000);

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

    // ──────── XP curve (production values) ────────

    #[test]
    fun test_xp_curve_anchors() {
        assert!(xp_for_level_for_testing(1)  == 0,         0);
        assert!(xp_for_level_for_testing(2)  == 100,       1);
        assert!(xp_for_level_for_testing(5)  == 1500,      2);
        assert!(xp_for_level_for_testing(10) == 50000,     3);
        assert!(xp_for_level_for_testing(15) == 350000,    4);
        assert!(xp_for_level_for_testing(20) == 1_000_000, 5);
    }

    #[test]
    fun test_xp_curve_strictly_increasing() {
        let mut i: u8 = 1;
        while (i < 20) {
            let lo = xp_for_level_for_testing(i);
            let hi = xp_for_level_for_testing(i + 1);
            assert!(hi > lo, (i as u64));
            i = i + 1;
        };
    }

    // ──────── create_character ────────

    #[test]
    fun test_create_character_initial_state() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let c = ts::take_shared<Character>(&scenario);
            assert!(character::owner(&c) == ALICE, 0);
            assert!(character::level(&c) == 1, 1);
            assert!(character::xp(&c) == 0, 2);
            assert!(character::strength(&c) == 5, 3);
            assert!(character::wins(&c) == 0, 4);
            assert!(character::losses(&c) == 0, 5);
            assert!(character::draws(&c) == 0, 9);
            assert!(character::rating(&c) == 1000, 6);
            assert!(character::unallocated_points(&c) == 0, 7);
            assert!(character::loadout_version(&c) == 0, 8);
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::character)]  // EInvalidStatTotal
    fun test_create_character_bad_stat_sum() {
        let mut scenario = ts::begin(PUBLISHER);
        ts::next_tx(&mut scenario, PUBLISHER);
        { init_for_testing(ts::ctx(&mut scenario)); };
        let clock = setup_clock(&mut scenario, 1_700_000_000_000);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<CharacterRegistry>(&scenario);
            // 5+5+5+4 = 19, should be 20
            character::create_character(
                string::utf8(b"BadAlice"),
                5, 5, 5, 4,
                &mut registry,
                &clock,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::character)]  // ENameTooLong
    fun test_create_character_name_too_long() {
        let mut scenario = ts::begin(PUBLISHER);
        ts::next_tx(&mut scenario, PUBLISHER);
        { init_for_testing(ts::ctx(&mut scenario)); };
        let clock = setup_clock(&mut scenario, 1_700_000_000_000);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<CharacterRegistry>(&scenario);
            // 33-char name (max is 32)
            character::create_character(
                string::utf8(b"abcdefghijklmnopqrstuvwxyz1234567"),
                5, 5, 5, 5,
                &mut registry,
                &clock,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — CharacterRegistry duplicate-mint guard ────────

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::character)]  // EWalletAlreadyHasCharacter
    fun test_create_character_duplicate_aborts() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);  // ALICE has a Character

        // ALICE tries to mint a SECOND character — should abort.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<CharacterRegistry>(&scenario);
            character::create_character(
                string::utf8(b"AliceTwo"),
                5, 5, 5, 5,
                &mut registry,
                &clock,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_registry_tracks_owner() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let registry = ts::take_shared<CharacterRegistry>(&scenario);
            assert!(character::registry_has(&registry, ALICE), 0);
            assert!(!character::registry_has(&registry, BOB), 1);
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — burn_character clears registry ────────

    #[test]
    fun test_burn_character_clears_registry() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        // Admin burns ALICE's character.
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let character = ts::take_shared<Character>(&scenario);
            let mut registry = ts::take_shared<CharacterRegistry>(&scenario);
            character::burn_character(&admin, character, &mut registry);
            assert!(!character::registry_has(&registry, ALICE), 0);
            ts::return_shared(registry);
            ts::return_to_sender(&scenario, admin);
        };

        // ALICE can now mint a fresh character on the same wallet.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<CharacterRegistry>(&scenario);
            character::create_character(
                string::utf8(b"AliceReborn"),
                4, 6, 5, 5,
                &mut registry,
                &clock,
                ts::ctx(&mut scenario),
            );
            assert!(character::registry_has(&registry, ALICE), 1);
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── update_after_fight + level-up ────────

    #[test]
    fun test_update_after_fight_levels_up_and_grants_points() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::update_after_fight(&admin, &mut c, true, 200, 1010, &clock);
            assert!(character::level(&c) == 2, 0);
            assert!(character::wins(&c) == 1, 1);
            assert!(character::rating(&c) == 1010, 2);
            assert!(character::unallocated_points(&c) == 3, 3);
            assert!(character::xp(&c) == 200, 4);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_update_after_fight_multiple_levels_in_one_call() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::update_after_fight(&admin, &mut c, true, 700, 1000, &clock);
            assert!(character::level(&c) == 4, 0);
            assert!(character::unallocated_points(&c) == 9, 1);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::character)]  // EXpTooHigh
    fun test_update_after_fight_xp_cap() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::update_after_fight(&admin, &mut c, true, 1001, 1010, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — update_after_fight_draw ────────

    #[test]
    fun test_update_after_fight_draw_increments_draws() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::update_after_fight_draw(&admin, &mut c, 50, &clock);
            assert!(character::draws(&c) == 1, 0);
            assert!(character::wins(&c) == 0, 1);
            assert!(character::losses(&c) == 0, 2);
            assert!(character::xp(&c) == 50, 3);
            // Rating unchanged on draws.
            assert!(character::rating(&c) == 1000, 4);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_update_after_fight_draw_can_level_up() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        // Two draws of 60 XP each = 120 XP; crosses L2 (100).
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::update_after_fight_draw(&admin, &mut c, 60, &clock);
            character::update_after_fight_draw(&admin, &mut c, 60, &clock);
            assert!(character::draws(&c) == 2, 0);
            assert!(character::level(&c) == 2, 1);
            assert!(character::unallocated_points(&c) == 3, 2);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── allocate_points ────────

    #[test]
    fun test_allocate_points_happy() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::update_after_fight(&admin, &mut c, true, 100, 1010, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            assert!(character::unallocated_points(&c) == 3, 0);
            character::allocate_points(&mut c, 1, 1, 1, 0, ts::ctx(&mut scenario));
            assert!(character::unallocated_points(&c) == 0, 1);
            assert!(character::strength(&c) == 6, 2);
            assert!(character::dexterity(&c) == 6, 3);
            assert!(character::intuition(&c) == 6, 4);
            assert!(character::endurance(&c) == 5, 5);
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::character)]  // ENotOwner
    fun test_allocate_points_non_owner() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::update_after_fight(&admin, &mut c, true, 100, 1010, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            character::allocate_points(&mut c, 1, 1, 1, 0, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::character)]  // ENotEnoughPoints
    fun test_allocate_points_not_enough() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut c = ts::take_shared<Character>(&scenario);
            character::allocate_points(&mut c, 1, 0, 0, 0, ts::ctx(&mut scenario));
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── set_fight_lock + duration cap ────────

    #[test]
    fun test_fight_lock_set_and_clear() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            let now = clock::timestamp_ms(&clock);
            character::set_fight_lock(&admin, &mut c, now + 600_000, &clock);
            assert!(character::is_fight_locked(&c, &clock), 0);

            character::set_fight_lock(&admin, &mut c, 0, &clock);
            assert!(!character::is_fight_locked(&c, &clock), 1);

            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_fight_lock_auto_expires() {
        let mut scenario = ts::begin(PUBLISHER);
        let mut clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            character::set_fight_lock(&admin, &mut c, clock::timestamp_ms(&clock) + 500_000, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::increment_for_testing(&mut clock, 600_000);

        ts::next_tx(&mut scenario, ALICE);
        {
            let c = ts::take_shared<Character>(&scenario);
            assert!(!character::is_fight_locked(&c, &clock), 0);
            ts::return_shared(c);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::character)]  // ELockTooLong
    fun test_fight_lock_duration_cap() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut c = ts::take_shared<Character>(&scenario);
            let now = clock::timestamp_ms(&clock);
            character::set_fight_lock(&admin, &mut c, now + 7_200_000, &clock);
            ts::return_shared(c);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // Silence unused-binding warning on BOB for tests that don't use it
    #[test]
    fun test_unused_bob_silencer() {
        let _ = BOB;
    }
}
