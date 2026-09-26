#[test_only]
module sui_combats::guild_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use std::string;

    use sui_combats::guild::{Self, Guild, GuildRegistry};
    use sui_combats::character::{Self, Character, CharacterRegistry, AdminCap};

    const TREASURY: address = @0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d;
    const ALICE: address = @0xA;
    const BOB:   address = @0xB;
    const CAROL: address = @0xC;
    const DAVE:  address = @0xD;
    const EVE:   address = @0xE;

    const ONE_SUI: u64 = 1_000_000_000;

    // ===== Bootstrap & helpers =====

    /// ALICE publishes (gets AdminCap), creates the GuildRegistry.
    fun bootstrap(scenario: &mut ts::Scenario): Clock {
        ts::next_tx(scenario, ALICE);
        {
            character::init_for_testing(ts::ctx(scenario));
        };
        ts::next_tx(scenario, ALICE);
        {
            let admin = ts::take_from_sender<AdminCap>(scenario);
            let mut char_registry = ts::take_shared<CharacterRegistry>(scenario);
            guild::create_guild_registry(&admin, &mut char_registry, ts::ctx(scenario));
            ts::return_shared(char_registry);
            ts::return_to_sender(scenario, admin);
        };
        ts::next_tx(scenario, ALICE);
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, 1_700_000_000_000);
        clock
    }

    fun mint_character(scenario: &mut ts::Scenario, owner: address, clock: &Clock): ID {
        ts::next_tx(scenario, owner);
        let mut registry = ts::take_shared<CharacterRegistry>(scenario);
        character::create_character(
            string::utf8(b"test"),
            5, 5, 5, 5,
            &mut registry,
            clock,
            ts::ctx(scenario),
        );
        let id = character::registry_get(&registry, owner);
        ts::return_shared(registry);
        id
    }

    fun create_guild_helper(
        scenario: &mut ts::Scenario,
        founder: address,
        char_id: ID,
        name: vector<u8>,
        open: bool,
        clock: &Clock,
    ) {
        ts::next_tx(scenario, founder);
        let mut registry = ts::take_shared<GuildRegistry>(scenario);
        let character = ts::take_shared_by_id<Character>(scenario, char_id);
        let fee = coin::mint_for_testing<SUI>(ONE_SUI, ts::ctx(scenario));
        guild::create_guild(&mut registry, &character, string::utf8(name), open, fee, clock, ts::ctx(scenario));
        ts::return_shared(character);
        ts::return_shared(registry);
    }

    fun join_helper(scenario: &mut ts::Scenario, who: address, char_id: ID, clock: &Clock) {
        ts::next_tx(scenario, who);
        let mut g = ts::take_shared<Guild>(scenario);
        let mut registry = ts::take_shared<GuildRegistry>(scenario);
        let character = ts::take_shared_by_id<Character>(scenario, char_id);
        guild::join_guild(&mut g, &mut registry, &character, clock, ts::ctx(scenario));
        ts::return_shared(character);
        ts::return_shared(registry);
        ts::return_shared(g);
    }

    fun invite_helper(scenario: &mut ts::Scenario, by: address, invitee: address) {
        ts::next_tx(scenario, by);
        let mut g = ts::take_shared<Guild>(scenario);
        guild::invite_member(&mut g, invitee, ts::ctx(scenario));
        ts::return_shared(g);
    }

    fun promote_helper(scenario: &mut ts::Scenario, by: address, member: address) {
        ts::next_tx(scenario, by);
        let mut g = ts::take_shared<Guild>(scenario);
        guild::promote_to_officer(&mut g, member, ts::ctx(scenario));
        ts::return_shared(g);
    }

    fun kick_helper(scenario: &mut ts::Scenario, by: address, member: address, clock: &Clock) {
        ts::next_tx(scenario, by);
        let mut g = ts::take_shared<Guild>(scenario);
        let mut registry = ts::take_shared<GuildRegistry>(scenario);
        guild::kick_member(&mut g, &mut registry, member, clock, ts::ctx(scenario));
        ts::return_shared(registry);
        ts::return_shared(g);
    }

    fun leave_helper(scenario: &mut ts::Scenario, who: address, clock: &Clock) {
        ts::next_tx(scenario, who);
        let mut g = ts::take_shared<Guild>(scenario);
        let mut registry = ts::take_shared<GuildRegistry>(scenario);
        guild::leave_guild(&mut g, &mut registry, clock, ts::ctx(scenario));
        ts::return_shared(registry);
        ts::return_shared(g);
    }

    fun donate_helper(scenario: &mut ts::Scenario, who: address, amount: u64) {
        ts::next_tx(scenario, who);
        let mut g = ts::take_shared<Guild>(scenario);
        let payment = coin::mint_for_testing<SUI>(amount, ts::ctx(scenario));
        guild::donate(&mut g, payment, ts::ctx(scenario));
        ts::return_shared(g);
    }

    fun withdraw_helper(scenario: &mut ts::Scenario, who: address, amount: u64, clock: &Clock) {
        ts::next_tx(scenario, who);
        let mut g = ts::take_shared<Guild>(scenario);
        guild::withdraw(&mut g, amount, clock, ts::ctx(scenario));
        ts::return_shared(g);
    }

    fun finish(scenario: ts::Scenario, clock: Clock) {
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ===== Registry bootstrap =====

    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::guild)]
    fun test_registry_second_create_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        ts::next_tx(&mut scenario, ALICE);
        {
            let admin = ts::take_from_sender<AdminCap>(&scenario);
            let mut char_registry = ts::take_shared<CharacterRegistry>(&scenario);
            guild::create_guild_registry(&admin, &mut char_registry, ts::ctx(&mut scenario));
            ts::return_shared(char_registry);
            ts::return_to_sender(&scenario, admin);
        };
        finish(scenario, clock);
    }

    // ===== Create =====

    #[test]
    fun test_create_guild_happy_path() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Iron Wolves", true, &clock);

        ts::next_tx(&mut scenario, ALICE);
        {
            let g = ts::take_shared<Guild>(&scenario);
            let registry = ts::take_shared<GuildRegistry>(&scenario);
            assert!(guild::leader(&g) == ALICE, 0);
            assert!(guild::member_count(&g) == 1, 1);
            assert!(guild::role_of(&g, ALICE) == guild::role_leader(), 2);
            assert!(guild::is_open(&g), 3);
            assert!(guild::registry_has_member(&registry, ALICE), 4);
            assert!(guild::registry_guild_of(&registry, ALICE) == object::id(&g), 5);
            assert!(guild::registry_name_taken(&registry, string::utf8(b"IRON WOLVES")), 6);
            assert!(guild::guild_count(&registry) == 1, 7);
            assert!(guild::rating(&g) == 1000, 8);
            ts::return_shared(registry);
            ts::return_shared(g);
        };
        // Fee landed at TREASURY.
        ts::next_tx(&mut scenario, TREASURY);
        {
            let fee = ts::take_from_address<Coin<SUI>>(&scenario, TREASURY);
            assert!(coin::value(&fee) == ONE_SUI, 9);
            ts::return_to_address(TREASURY, fee);
        };
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::guild)]
    fun test_create_wrong_fee_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        ts::next_tx(&mut scenario, ALICE);
        let mut registry = ts::take_shared<GuildRegistry>(&scenario);
        let character = ts::take_shared_by_id<Character>(&scenario, a);
        let fee = coin::mint_for_testing<SUI>(ONE_SUI / 2, ts::ctx(&mut scenario));
        guild::create_guild(&mut registry, &character, string::utf8(b"Cheap"), true, fee, &clock, ts::ctx(&mut scenario));
        ts::return_shared(character);
        ts::return_shared(registry);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::guild)]
    fun test_create_with_borrowed_character_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        // BOB passes ALICE's character.
        create_guild_helper(&mut scenario, BOB, a, b"Thieves", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::guild)]
    fun test_duplicate_name_case_insensitive_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Iron Wolves", true, &clock);
        create_guild_helper(&mut scenario, BOB, b, b"iRoN wOlVeS", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::guild)]
    fun test_create_second_guild_same_wallet_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"First", true, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Second", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::guild)]
    fun test_name_too_short_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"ab", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::guild)]
    fun test_name_bad_char_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Evil<script>", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::guild)]
    fun test_name_double_space_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Iron  Wolves", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::guild)]
    fun test_name_trailing_space_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Wolves ", true, &clock);
        finish(scenario, clock);
    }

    // ===== Join / invite =====

    #[test]
    fun test_open_join() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);

        ts::next_tx(&mut scenario, BOB);
        {
            let g = ts::take_shared<Guild>(&scenario);
            let registry = ts::take_shared<GuildRegistry>(&scenario);
            assert!(guild::member_count(&g) == 2, 0);
            assert!(guild::role_of(&g, BOB) == guild::role_member(), 1);
            assert!(guild::registry_has_member(&registry, BOB), 2);
            ts::return_shared(registry);
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 10, location = sui_combats::guild)]
    fun test_closed_join_without_invite_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Closed", false, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        finish(scenario, clock);
    }

    #[test]
    fun test_closed_join_with_invite_consumes_invite() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Closed", false, &clock);
        invite_helper(&mut scenario, ALICE, BOB);
        join_helper(&mut scenario, BOB, b, &clock);

        ts::next_tx(&mut scenario, BOB);
        {
            let g = ts::take_shared<Guild>(&scenario);
            assert!(guild::is_member(&g, BOB), 0);
            assert!(!guild::is_invited(&g, BOB), 1);
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 8, location = sui_combats::guild)]
    fun test_member_cannot_invite() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        invite_helper(&mut scenario, BOB, CAROL);
        finish(scenario, clock);
    }

    #[test]
    fun test_officer_can_invite_and_revoke() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        invite_helper(&mut scenario, BOB, CAROL);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            assert!(guild::is_invited(&g, CAROL), 0);
            guild::revoke_invite(&mut g, CAROL, ts::ctx(&mut scenario));
            assert!(!guild::is_invited(&g, CAROL), 1);
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    #[test]
    fun test_invitee_declines() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Closed", false, &clock);
        invite_helper(&mut scenario, ALICE, BOB);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            guild::decline_invite(&mut g, ts::ctx(&mut scenario));
            assert!(!guild::is_invited(&g, BOB), 0);
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 19, location = sui_combats::guild)]
    fun test_double_invite_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Closed", false, &clock);
        invite_helper(&mut scenario, ALICE, BOB);
        invite_helper(&mut scenario, ALICE, BOB);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::guild)]
    fun test_join_second_guild_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        let c = mint_character(&mut scenario, CAROL, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Guild One", true, &clock);
        join_helper(&mut scenario, CAROL, c, &clock);
        create_guild_helper(&mut scenario, BOB, b, b"Guild Two", true, &clock);

        // CAROL (already in Guild One) tries to join Guild Two.
        ts::next_tx(&mut scenario, CAROL);
        let mut registry = ts::take_shared<GuildRegistry>(&scenario);
        let guild_two_id = guild::registry_guild_of(&registry, BOB);
        let mut g2 = ts::take_shared_by_id<Guild>(&scenario, guild_two_id);
        let character = ts::take_shared_by_id<Character>(&scenario, c);
        guild::join_guild(&mut g2, &mut registry, &character, &clock, ts::ctx(&mut scenario));
        ts::return_shared(character);
        ts::return_shared(registry);
        ts::return_shared(g2);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 9, location = sui_combats::guild)]
    fun test_guild_full_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Big Guild", true, &clock);
        // Fill to MAX_MEMBERS (leader + 29), then one more.
        let mut i = 1;
        while (i <= guild::max_members()) {
            let who = sui::address::from_u256((1000 + i) as u256);
            let c = mint_character(&mut scenario, who, &clock);
            join_helper(&mut scenario, who, c, &clock);
            i = i + 1;
        };
        finish(scenario, clock);
    }

    // ===== Leave / kick / roles =====

    #[test]
    fun test_member_leaves_and_can_join_elsewhere() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        leave_helper(&mut scenario, BOB, &clock);

        ts::next_tx(&mut scenario, BOB);
        {
            let g = ts::take_shared<Guild>(&scenario);
            let registry = ts::take_shared<GuildRegistry>(&scenario);
            assert!(guild::member_count(&g) == 1, 0);
            assert!(!guild::registry_has_member(&registry, BOB), 1);
            ts::return_shared(registry);
            ts::return_shared(g);
        };
        // BOB can found their own guild now.
        create_guild_helper(&mut scenario, BOB, b, b"Bobs Band", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::guild)]
    fun test_leader_cannot_leave() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        leave_helper(&mut scenario, ALICE, &clock);
        finish(scenario, clock);
    }

    #[test]
    fun test_leader_kicks_officer() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        kick_helper(&mut scenario, ALICE, BOB, &clock);

        ts::next_tx(&mut scenario, ALICE);
        {
            let g = ts::take_shared<Guild>(&scenario);
            let registry = ts::take_shared<GuildRegistry>(&scenario);
            assert!(!guild::is_member(&g, BOB), 0);
            assert!(!guild::registry_has_member(&registry, BOB), 1);
            ts::return_shared(registry);
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    #[test]
    fun test_officer_kicks_member() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        let c = mint_character(&mut scenario, CAROL, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        join_helper(&mut scenario, CAROL, c, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        kick_helper(&mut scenario, BOB, CAROL, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::guild)]
    fun test_officer_cannot_kick_officer() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        let c = mint_character(&mut scenario, CAROL, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        join_helper(&mut scenario, CAROL, c, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        promote_helper(&mut scenario, ALICE, CAROL);
        kick_helper(&mut scenario, BOB, CAROL, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::guild)]
    fun test_officer_cannot_kick_leader() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        kick_helper(&mut scenario, BOB, ALICE, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 8, location = sui_combats::guild)]
    fun test_member_cannot_kick() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        let c = mint_character(&mut scenario, CAROL, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        join_helper(&mut scenario, CAROL, c, &clock);
        kick_helper(&mut scenario, BOB, CAROL, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::guild)]
    fun test_officer_cannot_promote() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        let c = mint_character(&mut scenario, CAROL, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        join_helper(&mut scenario, CAROL, c, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        promote_helper(&mut scenario, BOB, CAROL);
        finish(scenario, clock);
    }

    #[test]
    fun test_demote_officer() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            guild::demote_to_member(&mut g, BOB, ts::ctx(&mut scenario));
            assert!(guild::role_of(&g, BOB) == guild::role_member(), 0);
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    #[test]
    fun test_transfer_leadership() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            guild::transfer_leadership(&mut g, BOB, ts::ctx(&mut scenario));
            assert!(guild::leader(&g) == BOB, 0);
            assert!(guild::role_of(&g, BOB) == guild::role_leader(), 1);
            assert!(guild::role_of(&g, ALICE) == guild::role_officer(), 2);
            ts::return_shared(g);
        };
        // Old leader can now leave.
        leave_helper(&mut scenario, ALICE, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::guild)]
    fun test_transfer_leadership_to_outsider_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            guild::transfer_leadership(&mut g, EVE, ts::ctx(&mut scenario));
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    // ===== Treasury =====

    #[test]
    fun test_donate_and_leader_withdraw() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Rich Guild", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        donate_helper(&mut scenario, BOB, 3 * ONE_SUI);
        withdraw_helper(&mut scenario, ALICE, ONE_SUI, &clock);

        ts::next_tx(&mut scenario, ALICE);
        {
            let g = ts::take_shared<Guild>(&scenario);
            assert!(guild::treasury_value(&g) == 2 * ONE_SUI, 0);
            ts::return_shared(g);
            let payout = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&payout) == ONE_SUI, 1);
            ts::return_to_sender(&scenario, payout);
        };
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::guild)]
    fun test_outsider_cannot_donate() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Rich Guild", true, &clock);
        donate_helper(&mut scenario, EVE, ONE_SUI);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::guild)]
    fun test_officer_cannot_withdraw() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Rich Guild", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        promote_helper(&mut scenario, ALICE, BOB);
        donate_helper(&mut scenario, BOB, ONE_SUI);
        withdraw_helper(&mut scenario, BOB, ONE_SUI, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 15, location = sui_combats::guild)]
    fun test_withdraw_more_than_balance_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Rich Guild", true, &clock);
        donate_helper(&mut scenario, ALICE, ONE_SUI);
        withdraw_helper(&mut scenario, ALICE, ONE_SUI + 1, &clock);
        finish(scenario, clock);
    }

    // ===== Settings =====

    #[test]
    #[expected_failure(abort_code = 20, location = sui_combats::guild)]
    fun test_profile_description_too_long_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            let mut long = vector<u8>[];
            let mut i = 0u64;
            while (i < 281) { long.push_back(120); i = i + 1; };
            guild::set_profile(&mut g, string::utf8(long), string::utf8(b""), ts::ctx(&mut scenario));
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::guild)]
    fun test_member_cannot_set_open() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Open House", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        ts::next_tx(&mut scenario, BOB);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            guild::set_open(&mut g, false, ts::ctx(&mut scenario));
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    // ===== War lock =====

    #[test]
    #[expected_failure(abort_code = 17, location = sui_combats::guild)]
    fun test_war_lock_blocks_leave() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"At War", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            let now = clock::timestamp_ms(&clock);
            guild::set_war_lock(&mut g, now + 600_000, &clock);
            ts::return_shared(g);
        };
        leave_helper(&mut scenario, BOB, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 17, location = sui_combats::guild)]
    fun test_war_lock_blocks_withdraw() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"At War", true, &clock);
        donate_helper(&mut scenario, ALICE, ONE_SUI);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            let now = clock::timestamp_ms(&clock);
            guild::set_war_lock(&mut g, now + 600_000, &clock);
            ts::return_shared(g);
        };
        withdraw_helper(&mut scenario, ALICE, ONE_SUI, &clock);
        finish(scenario, clock);
    }

    #[test]
    fun test_war_lock_expires() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"At War", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            let now = clock::timestamp_ms(&clock);
            guild::set_war_lock(&mut g, now + 600_000, &clock);
            ts::return_shared(g);
        };
        clock::increment_for_testing(&mut clock, 600_000);
        leave_helper(&mut scenario, BOB, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 23, location = sui_combats::guild)]
    fun test_war_lock_too_long_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"At War", true, &clock);
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut g = ts::take_shared<Guild>(&scenario);
            let now = clock::timestamp_ms(&clock);
            guild::set_war_lock(&mut g, now + 7_200_001, &clock);
            ts::return_shared(g);
        };
        finish(scenario, clock);
    }

    // ===== Disband =====

    #[test]
    fun test_disband_pays_treasury_and_frees_name() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Short Lived", true, &clock);
        donate_helper(&mut scenario, ALICE, 2 * ONE_SUI);

        ts::next_tx(&mut scenario, ALICE);
        {
            let g = ts::take_shared<Guild>(&scenario);
            let mut registry = ts::take_shared<GuildRegistry>(&scenario);
            guild::disband_guild(g, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(!guild::registry_has_member(&registry, ALICE), 0);
            assert!(!guild::registry_name_taken(&registry, string::utf8(b"Short Lived")), 1);
            assert!(guild::guild_count(&registry) == 0, 2);
            ts::return_shared(registry);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let payout = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&payout) == 2 * ONE_SUI, 3);
            ts::return_to_sender(&scenario, payout);
        };
        // Name is reusable.
        create_guild_helper(&mut scenario, BOB, b, b"short lived", true, &clock);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 16, location = sui_combats::guild)]
    fun test_disband_with_members_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        let b = mint_character(&mut scenario, BOB, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Busy Guild", true, &clock);
        join_helper(&mut scenario, BOB, b, &clock);
        ts::next_tx(&mut scenario, ALICE);
        let g = ts::take_shared<Guild>(&scenario);
        let mut registry = ts::take_shared<GuildRegistry>(&scenario);
        guild::disband_guild(g, &mut registry, &clock, ts::ctx(&mut scenario));
        ts::return_shared(registry);
        finish(scenario, clock);
    }

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::guild)]
    fun test_non_leader_disband_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let a = mint_character(&mut scenario, ALICE, &clock);
        create_guild_helper(&mut scenario, ALICE, a, b"Mine", true, &clock);
        ts::next_tx(&mut scenario, EVE);
        let g = ts::take_shared<Guild>(&scenario);
        let mut registry = ts::take_shared<GuildRegistry>(&scenario);
        guild::disband_guild(g, &mut registry, &clock, ts::ctx(&mut scenario));
        ts::return_shared(registry);
        finish(scenario, clock);
    }

    #[test]
    fun test_dave_unused() {
        // Keeps DAVE constant referenced (lint-clean) for future multi-guild tests.
        assert!(DAVE != EVE, 0);
    }
}
