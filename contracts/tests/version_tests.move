#[test_only]
module sui_combats::version_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use std::string;
    use sui_combats::character::{Self, Character, CharacterRegistry};
    use sui_combats::version;

    const ALICE: address = @0xA;

    fun setup(s: &mut ts::Scenario): ID {
        ts::next_tx(s, ALICE);
        character::init_for_testing(ts::ctx(s));
        ts::next_tx(s, ALICE);
        let clock = clock::create_for_testing(ts::ctx(s));
        let mut reg = ts::take_shared<CharacterRegistry>(s);
        character::create_character(string::utf8(b"a"), 5, 5, 5, 5, &mut reg, &clock, ts::ctx(s));
        let id = character::registry_get(&reg, ALICE);
        ts::return_shared(reg);
        clock::destroy_for_testing(clock);
        id
    }

    #[test]
    fun test_current_version_is_1() { assert!(version::current() == 1, 0); }

    /// An object from another package version is rejected by every entry.
    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::version)]  // EWrongVersion
    fun test_wrong_version_object_rejected() {
        let mut s = ts::begin(ALICE);
        let id = setup(&mut s);
        ts::next_tx(&mut s, ALICE);
        {
            let mut c = ts::take_shared_by_id<Character>(&s, id);
            character::set_version_for_testing(&mut c, 2);
            character::allocate_points(&mut c, 0, 0, 0, 0, ts::ctx(&mut s));
            ts::return_shared(c);
        };
        ts::end(s);
    }

    #[test]
    fun test_migrate_moves_old_object_up() {
        let mut s = ts::begin(ALICE);
        let id = setup(&mut s);
        ts::next_tx(&mut s, ALICE);
        {
            let mut c = ts::take_shared_by_id<Character>(&s, id);
            character::set_version_for_testing(&mut c, 0);
            character::migrate_character(&mut c);
            ts::return_shared(c);
        };
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::version)]  // EAlreadyCurrent
    fun test_migrate_current_object_aborts() {
        let mut s = ts::begin(ALICE);
        let id = setup(&mut s);
        ts::next_tx(&mut s, ALICE);
        {
            let mut c = ts::take_shared_by_id<Character>(&s, id);
            character::migrate_character(&mut c);
            ts::return_shared(c);
        };
        ts::end(s);
    }
}
