#[test_only]
module sui_combats::character_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use std::string;

    use sui_combats::character::{
        Self,
        Character,
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

    /// Boot AdminCap + one shared Character owned by ALICE. Returns the Clock
    /// so the caller can advance it. Character must be taken from shared via ts.
    fun bootstrap(scenario: &mut ts::Scenario): Clock {
        // Initialize the package (mints AdminCap to PUBLISHER)
        ts::next_tx(scenario, PUBLISHER);
        {
            init_for_testing(ts::ctx(scenario));
        };

        let clock = setup_clock(scenario, 1_700_000_000_000);

        // ALICE creates her character
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

    // ──────── XP threshold tests (production values) ────────

    #[test]
    fun test_xp_threshold_level_1_is_zero() {
        assert!(xp_for_level_for_testing(1) == 0, 0);
    }

    #[test]
    fun test_xp_threshold_level_2_is_production() {
        // Test values were 2; production is 100.
        assert!(xp_for_level_for_testing(2) == 100, 1);
    }

    #[test]
    fun test_xp_thresholds_match_gdd_anchors() {
        assert!(xp_for_level_for_testing(2) == 100, 0);
        assert!(xp_for_level_for_testing(5) == 1500, 1);
        assert!(xp_for_level_for_testing(10) == 50000, 2);
        assert!(xp_for_level_for_testing(15) == 350000, 3);
        assert!(xp_for_level_for_testing(20) == 1_000_000, 4);
    }

    #[test]
    fun test_xp_thresholds_are_strictly_increasing() {
        let mut i: u8 = 1;
        while (i < 20) {
            let lo = xp_for_level_for_testing(i);
            let hi = xp_for_level_for_testing(i + 1);
            assert!(hi > lo, (i as u64));
            i = i + 1;
        };
    }

    // ──────── Fight-lock DF tests ────────

    #[test]
    fun test_is_fight_locked_false_when_no_df() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let character = ts::take_shared<Character>(&scenario);
            assert!(!character::is_fight_locked(&character, &clock), 0);
            ts::return_shared(character);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_set_fight_lock_then_is_locked() {
        let mut scenario = ts::begin(PUBLISHER);
        let mut clock = bootstrap(&mut scenario);

        // Admin sets lock expiry 10 min (600_000 ms) in the future
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut character = ts::take_shared<Character>(&scenario);
            let expiry = clock::timestamp_ms(&clock) + 600_000;
            character::set_fight_lock(&admin, &mut character, expiry);
            assert!(character::is_fight_locked(&character, &clock), 0);
            ts::return_shared(character);
            ts::return_to_sender(&scenario, admin);
        };

        // Advance clock 11 min — should auto-expire
        clock::increment_for_testing(&mut clock, 660_000);
        ts::next_tx(&mut scenario, ALICE);
        {
            let character = ts::take_shared<Character>(&scenario);
            assert!(!character::is_fight_locked(&character, &clock), 1);
            ts::return_shared(character);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_unlock_via_zero_expiry() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        // Lock then manually unlock without waiting
        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut character = ts::take_shared<Character>(&scenario);
            character::set_fight_lock(&admin, &mut character, clock::timestamp_ms(&clock) + 100_000);
            assert!(character::is_fight_locked(&character, &clock), 0);

            character::set_fight_lock(&admin, &mut character, 0);
            assert!(!character::is_fight_locked(&character, &clock), 1);

            ts::return_shared(character);
            ts::return_to_sender(&scenario, admin);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_lock_can_be_extended() {
        let mut scenario = ts::begin(PUBLISHER);
        let mut clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut character = ts::take_shared<Character>(&scenario);

            // First lock: 5 min
            character::set_fight_lock(&admin, &mut character, clock::timestamp_ms(&clock) + 300_000);
            // Extend to 15 min
            character::set_fight_lock(&admin, &mut character, clock::timestamp_ms(&clock) + 900_000);

            ts::return_shared(character);
            ts::return_to_sender(&scenario, admin);
        };

        // Advance 10 min — should still be locked (15 > 10)
        clock::increment_for_testing(&mut clock, 600_000);
        ts::next_tx(&mut scenario, ALICE);
        {
            let character = ts::take_shared<Character>(&scenario);
            assert!(character::is_fight_locked(&character, &clock), 0);
            ts::return_shared(character);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_character_owner_is_sender() {
        let mut scenario = ts::begin(PUBLISHER);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let character = ts::take_shared<Character>(&scenario);
            assert!(character::owner(&character) == ALICE, 0);
            ts::return_shared(character);
        };

        // Unused in this test but silence BOB
        let _ = BOB;

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
