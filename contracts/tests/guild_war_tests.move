#[test_only]
module sui_combats::guild_war_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use std::string;

    use sui_combats::guild::{Self, Guild, GuildRegistry};
    use sui_combats::guild_war::{Self, GuildWar, WarRegistry};
    use sui_combats::character::{Self, Character, CharacterRegistry, AdminCap};

    const TREASURY: address = @0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d;
    const ALICE: address = @0xA;  // leader, Wolves
    const CAROL: address = @0xC;  // Wolves
    const EVE: address = @0xE;    // Wolves
    const BOB: address = @0xB;    // leader, Crows
    const DAVE: address = @0xD;   // Crows
    const FRANK: address = @0xF;  // Crows
    const OUTSIDER: address = @0x99;

    const ONE_SUI: u64 = 1_000_000_000;
    const STAKE: u64 = 500_000_000;
    const DELAY: u64 = 600_000;   // 10 min

    public struct World has drop { wolves: ID, crows: ID }

    fun mint_char(s: &mut ts::Scenario, who: address, level: u8, clock: &Clock): ID {
        ts::next_tx(s, who);
        let mut reg = ts::take_shared<CharacterRegistry>(s);
        character::create_character(string::utf8(b"x"), 5, 5, 5, 5, &mut reg, clock, ts::ctx(s));
        let id = character::registry_get(&reg, who);
        ts::return_shared(reg);
        if (level > 1) {
            ts::next_tx(s, who);
            let mut c = ts::take_shared_by_id<Character>(s, id);
            character::set_level_for_testing(&mut c, level);
            ts::return_shared(c);
        };
        id
    }

    /// Bootstraps: characters (all level 5), two open guilds, registries.
    fun setup(s: &mut ts::Scenario): (Clock, World) {
        ts::next_tx(s, ALICE);
        {
            character::init_for_testing(ts::ctx(s));
            guild_war::init_for_testing(ts::ctx(s));
        };
        ts::next_tx(s, ALICE);
        {
            let admin = ts::take_from_sender<AdminCap>(s);
            let mut cr = ts::take_shared<CharacterRegistry>(s);
            guild::create_guild_registry(&admin, &mut cr, ts::ctx(s));
            ts::return_shared(cr);
            ts::return_to_sender(s, admin);
        };
        ts::next_tx(s, ALICE);
        let mut clock = clock::create_for_testing(ts::ctx(s));
        clock::set_for_testing(&mut clock, 1_700_000_000_000);

        let people = vector[ALICE, CAROL, EVE, BOB, DAVE, FRANK];
        let mut i = 0;
        while (i < people.length()) { mint_char(s, people[i], 5, &clock); i = i + 1; };

        let wolves = found(s, ALICE, b"Iron Wolves", &clock);
        let crows = found(s, BOB, b"Black Crows", &clock);
        join_guild(s, CAROL, wolves, &clock);
        join_guild(s, EVE, wolves, &clock);
        join_guild(s, DAVE, crows, &clock);
        join_guild(s, FRANK, crows, &clock);
        (clock, World { wolves, crows })
    }

    fun char_of(s: &ts::Scenario, who: address): ID {
        let reg = ts::take_shared<CharacterRegistry>(s);
        let id = character::registry_get(&reg, who);
        ts::return_shared(reg);
        id
    }

    fun found(s: &mut ts::Scenario, leader: address, name: vector<u8>, clock: &Clock): ID {
        ts::next_tx(s, leader);
        let cid = char_of(s, leader);
        let mut reg = ts::take_shared<GuildRegistry>(s);
        let c = ts::take_shared_by_id<Character>(s, cid);
        let fee = coin::mint_for_testing<SUI>(ONE_SUI, ts::ctx(s));
        guild::create_guild(&mut reg, &c, string::utf8(name), true, fee, clock, ts::ctx(s));
        let gid = guild::registry_guild_of(&reg, leader);
        ts::return_shared(c);
        ts::return_shared(reg);
        gid
    }

    fun join_guild(s: &mut ts::Scenario, who: address, gid: ID, clock: &Clock) {
        ts::next_tx(s, who);
        let cid = char_of(s, who);
        let mut g = ts::take_shared_by_id<Guild>(s, gid);
        let mut reg = ts::take_shared<GuildRegistry>(s);
        let c = ts::take_shared_by_id<Character>(s, cid);
        guild::join_guild(&mut g, &mut reg, &c, clock, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(reg); ts::return_shared(g);
    }

    fun declare(s: &mut ts::Scenario, who: address, w: &World, team: u64, stake: u64, rule: u8, clock: &Clock) {
        ts::next_tx(s, who);
        let cid = char_of(s, who);
        let mut a = ts::take_shared_by_id<Guild>(s, w.wolves);
        let b = ts::take_shared_by_id<Guild>(s, w.crows);
        let c = ts::take_shared_by_id<Character>(s, cid);
        guild_war::declare_war(&mut a, &b, &c, team, stake, rule, DELAY, clock, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(b); ts::return_shared(a);
    }

    fun accept(s: &mut ts::Scenario, who: address, w: &World, clock: &Clock) {
        ts::next_tx(s, who);
        let mut war = ts::take_shared<GuildWar>(s);
        let mut b = ts::take_shared_by_id<Guild>(s, w.crows);
        guild_war::accept_war(&mut war, &mut b, clock, ts::ctx(s));
        ts::return_shared(b); ts::return_shared(war);
    }

    fun join(s: &mut ts::Scenario, who: address, gid: ID, amount: u64, clock: &Clock) {
        ts::next_tx(s, who);
        let cid = char_of(s, who);
        let mut war = ts::take_shared<GuildWar>(s);
        let mut reg = ts::take_shared<WarRegistry>(s);
        let g = ts::take_shared_by_id<Guild>(s, gid);
        let c = ts::take_shared_by_id<Character>(s, cid);
        let stake = coin::mint_for_testing<SUI>(amount, ts::ctx(s));
        guild_war::join_war(&mut war, &mut reg, &g, &c, stake, clock, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(g); ts::return_shared(reg); ts::return_shared(war);
    }

    fun start(s: &mut ts::Scenario, who: address, w: &World, clock: &Clock) {
        ts::next_tx(s, who);
        let mut war = ts::take_shared<GuildWar>(s);
        let mut reg = ts::take_shared<WarRegistry>(s);
        let mut a = ts::take_shared_by_id<Guild>(s, w.wolves);
        let mut b = ts::take_shared_by_id<Guild>(s, w.crows);
        guild_war::start_war(&mut war, &mut reg, &mut a, &mut b, clock, ts::ctx(s));
        ts::return_shared(b); ts::return_shared(a); ts::return_shared(reg); ts::return_shared(war);
    }

    fun settle(s: &mut ts::Scenario, w: &World, winner: u8, clock: &Clock) {
        ts::next_tx(s, TREASURY);
        let mut war = ts::take_shared<GuildWar>(s);
        let mut reg = ts::take_shared<WarRegistry>(s);
        let mut a = ts::take_shared_by_id<Guild>(s, w.wolves);
        let mut b = ts::take_shared_by_id<Guild>(s, w.crows);
        guild_war::settle_war(&mut war, &mut reg, &mut a, &mut b, winner, clock, ts::ctx(s));
        ts::return_shared(b); ts::return_shared(a); ts::return_shared(reg); ts::return_shared(war);
    }

    fun coin_total(s: &ts::Scenario, who: address): u64 {
        let ids = ts::ids_for_address<Coin<SUI>>(who);
        let mut total = 0; let mut i = 0;
        while (i < ids.length()) {
            let c = ts::take_from_address_by_id<Coin<SUI>>(s, who, ids[i]);
            total = total + coin::value(&c);
            ts::return_to_address(who, c);
            i = i + 1;
        };
        total
    }

    fun war_ready_2v2_plus_extra(s: &mut ts::Scenario, w: &World, clock: &mut Clock) {
        declare(s, ALICE, w, 2, STAKE, 0, clock);
        accept(s, BOB, w, clock);
        join(s, ALICE, w.wolves, STAKE, clock);
        join(s, CAROL, w.wolves, STAKE, clock);
        join(s, BOB, w.crows, STAKE, clock);
        join(s, DAVE, w.crows, STAKE, clock);
        clock::increment_for_testing(clock, DELAY);
    }

    // ───────────── happy paths ─────────────

    #[test]
    fun test_full_war_wolves_win() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        war_ready_2v2_plus_extra(&mut s, &w, &mut clock);
        start(&mut s, TREASURY, &w, &clock);

        ts::next_tx(&mut s, ALICE);
        {
            let war = ts::take_shared<GuildWar>(&s);
            assert!(guild_war::status(&war) == guild_war::status_active(), 0);
            assert!(guild_war::escrow_value(&war) == 4 * STAKE, 1);
            ts::return_shared(war);
            let a = ts::take_shared_by_id<Guild>(&s, w.wolves);
            assert!(guild::war_locked_until(&a) > clock::timestamp_ms(&clock), 2);
            ts::return_shared(a);
        };

        settle(&mut s, &w, guild_war::side_a_id(), &clock);
        ts::next_tx(&mut s, ALICE);
        {
            // pot 2 SUI, fee 5% = 0.1, each winner 0.95
            assert!(coin_total(&s, ALICE) == 950_000_000, 3);
            assert!(coin_total(&s, CAROL) == 950_000_000, 4);
            assert!(coin_total(&s, BOB) == 0, 5);
            let war = ts::take_shared<GuildWar>(&s);
            assert!(guild_war::status(&war) == guild_war::status_settled(), 6);
            assert!(guild_war::escrow_value(&war) == 0, 7);
            ts::return_shared(war);
            let a = ts::take_shared_by_id<Guild>(&s, w.wolves);
            let b = ts::take_shared_by_id<Guild>(&s, w.crows);
            assert!(guild::wins(&a) == 1 && guild::losses(&b) == 1, 8);
            assert!(guild::rating(&a) == 1016 && guild::rating(&b) == 984, 9);
            assert!(!guild::has_open_war(&a) && !guild::has_open_war(&b), 10);
            assert!(guild::war_locked_until(&a) == 0, 11);
            ts::return_shared(b); ts::return_shared(a);
            let reg = ts::take_shared<WarRegistry>(&s);
            assert!(!guild_war::in_war(&reg, ALICE) && !guild_war::in_war(&reg, DAVE), 12);
            ts::return_shared(reg);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    fun test_scales_trim_extra_signups() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 3, STAKE, 0, &clock);
        accept(&mut s, BOB, &w, &clock);
        join(&mut s, ALICE, w.wolves, STAKE, &clock);
        join(&mut s, CAROL, w.wolves, STAKE, &clock);
        join(&mut s, EVE, w.wolves, STAKE, &clock);      // 3 wolves
        join(&mut s, BOB, w.crows, STAKE, &clock);
        join(&mut s, DAVE, w.crows, STAKE, &clock);      // 2 crows
        clock::increment_for_testing(&mut clock, DELAY);
        start(&mut s, TREASURY, &w, &clock);
        ts::next_tx(&mut s, EVE);
        {
            assert!(coin_total(&s, EVE) == STAKE, 0);    // last signer refunded
            let war = ts::take_shared<GuildWar>(&s);
            assert!(guild_war::side_a(&war).length() == 2 && guild_war::side_b(&war).length() == 2, 1);
            ts::return_shared(war);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    fun test_draw_refunds_everyone() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        war_ready_2v2_plus_extra(&mut s, &w, &mut clock);
        start(&mut s, TREASURY, &w, &clock);
        settle(&mut s, &w, guild_war::draw_id(), &clock);
        ts::next_tx(&mut s, ALICE);
        {
            assert!(coin_total(&s, ALICE) == STAKE && coin_total(&s, DAVE) == STAKE, 0);
            let a = ts::take_shared_by_id<Guild>(&s, w.wolves);
            assert!(guild::draws(&a) == 1 && guild::rating(&a) == 1000, 1);
            ts::return_shared(a);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    fun test_too_few_fighters_cancels_with_refund() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        accept(&mut s, BOB, &w, &clock);
        join(&mut s, ALICE, w.wolves, STAKE, &clock);
        join(&mut s, CAROL, w.wolves, STAKE, &clock);
        join(&mut s, BOB, w.crows, STAKE, &clock);       // only 1 crow
        clock::increment_for_testing(&mut clock, DELAY);
        start(&mut s, TREASURY, &w, &clock);
        ts::next_tx(&mut s, ALICE);
        {
            assert!(coin_total(&s, ALICE) == STAKE && coin_total(&s, BOB) == STAKE, 0);
            let war = ts::take_shared<GuildWar>(&s);
            assert!(guild_war::status(&war) == guild_war::status_cancelled(), 1);
            ts::return_shared(war);
            let a = ts::take_shared_by_id<Guild>(&s, w.wolves);
            assert!(!guild::has_open_war(&a), 2);
            ts::return_shared(a);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    fun test_honour_war_zero_stake() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, 0, 0, &clock);
        accept(&mut s, BOB, &w, &clock);
        join(&mut s, ALICE, w.wolves, 0, &clock);
        join(&mut s, CAROL, w.wolves, 0, &clock);
        join(&mut s, BOB, w.crows, 0, &clock);
        join(&mut s, DAVE, w.crows, 0, &clock);
        clock::increment_for_testing(&mut clock, DELAY);
        start(&mut s, TREASURY, &w, &clock);
        settle(&mut s, &w, guild_war::side_b_id(), &clock);
        ts::next_tx(&mut s, BOB);
        {
            let b = ts::take_shared_by_id<Guild>(&s, w.crows);
            assert!(guild::wins(&b) == 1, 0);
            ts::return_shared(b);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    fun test_leave_before_start_refunds() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        join(&mut s, CAROL, w.wolves, STAKE, &clock);
        ts::next_tx(&mut s, CAROL);
        {
            let mut war = ts::take_shared<GuildWar>(&s);
            let mut reg = ts::take_shared<WarRegistry>(&s);
            guild_war::leave_war(&mut war, &mut reg, &clock, ts::ctx(&mut s));
            assert!(!guild_war::in_war(&reg, CAROL), 0);
            ts::return_shared(reg); ts::return_shared(war);
        };
        ts::next_tx(&mut s, CAROL);
        assert!(coin_total(&s, CAROL) == STAKE, 1);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    // ───────────── guards ─────────────

    #[test]
    #[expected_failure(abort_code = 0, location = sui_combats::guild_war)]  // ENotOfficer
    fun test_member_cannot_declare() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, CAROL, &w, 2, STAKE, 0, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::guild_war)]  // EBadTeamSize
    fun test_team_size_11_aborts() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 11, STAKE, 0, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 24, location = sui_combats::guild)]      // EOpenWar
    fun test_second_open_war_aborts() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 14, location = sui_combats::guild_war)] // EWrongStake
    fun test_wrong_stake_aborts() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        join(&mut s, CAROL, w.wolves, STAKE - 1, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 9, location = sui_combats::guild_war)]  // ENotMember
    fun test_crow_cannot_join_for_wolves() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        join(&mut s, DAVE, w.wolves, STAKE, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 10, location = sui_combats::guild_war)] // ELevelOutOfRange
    fun test_level_rule_same_blocks_other_levels() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        ts::next_tx(&mut s, CAROL);
        {
            let cid = char_of(&s, CAROL);
            let mut c = ts::take_shared_by_id<Character>(&s, cid);
            character::set_level_for_testing(&mut c, 7);
            ts::return_shared(c);
        };
        declare(&mut s, ALICE, &w, 2, STAKE, 1, &clock);   // same level (5)
        join(&mut s, CAROL, w.wolves, STAKE, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::guild_war)] // ESideFull
    fun test_side_full_aborts() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        join(&mut s, ALICE, w.wolves, STAKE, &clock);
        join(&mut s, CAROL, w.wolves, STAKE, &clock);
        join(&mut s, EVE, w.wolves, STAKE, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 8, location = sui_combats::guild_war)]  // ESignupClosed
    fun test_join_after_start_time_aborts() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        clock::increment_for_testing(&mut clock, DELAY);
        join(&mut s, CAROL, w.wolves, STAKE, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 16, location = sui_combats::guild_war)] // EUnauthorized
    fun test_player_cannot_start() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        war_ready_2v2_plus_extra(&mut s, &w, &mut clock);
        start(&mut s, ALICE, &w, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 17, location = sui_combats::guild_war)] // ETooEarly
    fun test_start_before_time_aborts() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        accept(&mut s, BOB, &w, &clock);
        start(&mut s, TREASURY, &w, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 17, location = sui_combats::guild)]      // EWarLocked
    fun test_member_cannot_leave_guild_mid_war() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        war_ready_2v2_plus_extra(&mut s, &w, &mut clock);
        start(&mut s, TREASURY, &w, &clock);
        ts::next_tx(&mut s, CAROL);
        {
            let mut g = ts::take_shared_by_id<Guild>(&s, w.wolves);
            let mut reg = ts::take_shared<GuildRegistry>(&s);
            guild::leave_guild(&mut g, &mut reg, &clock, ts::ctx(&mut s));
            ts::return_shared(reg); ts::return_shared(g);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    // ───────────── escape hatches ─────────────

    #[test]
    fun test_expire_unaccepted_war_refunds() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        join(&mut s, ALICE, w.wolves, STAKE, &clock);
        clock::increment_for_testing(&mut clock, DELAY);
        ts::next_tx(&mut s, OUTSIDER);
        {
            let mut war = ts::take_shared<GuildWar>(&s);
            let mut reg = ts::take_shared<WarRegistry>(&s);
            let mut a = ts::take_shared_by_id<Guild>(&s, w.wolves);
            let mut b = ts::take_shared_by_id<Guild>(&s, w.crows);
            guild_war::expire_war(&mut war, &mut reg, &mut a, &mut b, &clock, ts::ctx(&mut s));
            assert!(!guild::has_open_war(&a), 0);
            ts::return_shared(b); ts::return_shared(a); ts::return_shared(reg); ts::return_shared(war);
        };
        ts::next_tx(&mut s, ALICE);
        assert!(coin_total(&s, ALICE) == STAKE, 1);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 19, location = sui_combats::guild_war)] // ENotExpired
    fun test_expire_too_early_aborts() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        ts::next_tx(&mut s, OUTSIDER);
        {
            let mut war = ts::take_shared<GuildWar>(&s);
            let mut reg = ts::take_shared<WarRegistry>(&s);
            let mut a = ts::take_shared_by_id<Guild>(&s, w.wolves);
            let mut b = ts::take_shared_by_id<Guild>(&s, w.crows);
            guild_war::expire_war(&mut war, &mut reg, &mut a, &mut b, &clock, ts::ctx(&mut s));
            ts::return_shared(b); ts::return_shared(a); ts::return_shared(reg); ts::return_shared(war);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    fun reclaim(s: &mut ts::Scenario, who: address, w: &World, clock: &Clock) {
        ts::next_tx(s, who);
        let mut war = ts::take_shared<GuildWar>(s);
        let mut reg = ts::take_shared<WarRegistry>(s);
        let mut a = ts::take_shared_by_id<Guild>(s, w.wolves);
        let mut b = ts::take_shared_by_id<Guild>(s, w.crows);
        guild_war::reclaim_stalled_war(&mut war, &mut reg, &mut a, &mut b, clock, ts::ctx(s));
        ts::return_shared(b); ts::return_shared(a); ts::return_shared(reg); ts::return_shared(war);
    }

    #[test]
    fun test_reclaim_stalled_war_after_60_min() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        war_ready_2v2_plus_extra(&mut s, &w, &mut clock);
        start(&mut s, TREASURY, &w, &clock);
        clock::increment_for_testing(&mut clock, 3_600_000);
        reclaim(&mut s, DAVE, &w, &clock);
        ts::next_tx(&mut s, ALICE);
        {
            assert!(coin_total(&s, ALICE) == STAKE && coin_total(&s, DAVE) == STAKE, 0);
            let a = ts::take_shared_by_id<Guild>(&s, w.wolves);
            assert!(guild::war_locked_until(&a) == 0 && !guild::has_open_war(&a), 1);
            ts::return_shared(a);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 17, location = sui_combats::guild_war)] // ETooEarly
    fun test_reclaim_too_early_aborts() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        war_ready_2v2_plus_extra(&mut s, &w, &mut clock);
        start(&mut s, TREASURY, &w, &clock);
        clock::increment_for_testing(&mut clock, 3_599_999);
        reclaim(&mut s, DAVE, &w, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 20, location = sui_combats::guild_war)] // ENotParticipant
    fun test_reclaim_by_outsider_aborts() {
        let mut s = ts::begin(ALICE);
        let (mut clock, w) = setup(&mut s);
        war_ready_2v2_plus_extra(&mut s, &w, &mut clock);
        start(&mut s, TREASURY, &w, &clock);
        clock::increment_for_testing(&mut clock, 3_600_000);
        reclaim(&mut s, EVE, &w, &clock);
        clock::destroy_for_testing(clock);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 24, location = sui_combats::guild)]      // EOpenWar
    fun test_disband_with_open_war_aborts() {
        let mut s = ts::begin(ALICE);
        let (clock, w) = setup(&mut s);
        declare(&mut s, ALICE, &w, 2, STAKE, 0, &clock);
        // empty the guild so only the open war blocks disbanding
        ts::next_tx(&mut s, CAROL);
        { let mut g = ts::take_shared_by_id<Guild>(&s, w.wolves); let mut r = ts::take_shared<GuildRegistry>(&s);
          guild::leave_guild(&mut g, &mut r, &clock, ts::ctx(&mut s)); ts::return_shared(r); ts::return_shared(g); };
        ts::next_tx(&mut s, EVE);
        { let mut g = ts::take_shared_by_id<Guild>(&s, w.wolves); let mut r = ts::take_shared<GuildRegistry>(&s);
          guild::leave_guild(&mut g, &mut r, &clock, ts::ctx(&mut s)); ts::return_shared(r); ts::return_shared(g); };
        ts::next_tx(&mut s, ALICE);
        {
            let g = ts::take_shared_by_id<Guild>(&s, w.wolves);
            let mut r = ts::take_shared<GuildRegistry>(&s);
            guild::disband_guild(g, &mut r, &clock, ts::ctx(&mut s));
            ts::return_shared(r);
        };
        clock::destroy_for_testing(clock);
        ts::end(s);
    }
}
