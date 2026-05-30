#[test_only]
module sui_combats::arena_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::sui::SUI;
    use std::string;

    use sui_combats::arena::{Self, WagerMatch, OpenWagerRegistry};
    use sui_combats::character::{Self, Character, CharacterRegistry};

    /// TREASURY in arena.move is hardcoded to the v5 publisher wallet.
    const TREASURY: address = @0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d;
    const ALICE: address = @0xA;
    const BOB:   address = @0xB;
    const CAROL: address = @0xC;
    const EVE:   address = @0xE;

    const STAKE_1_SUI: u64 = 1_000_000_000;

    // ===== Bootstrap & helpers =====

    fun bootstrap(scenario: &mut ts::Scenario): Clock {
        ts::next_tx(scenario, ALICE);
        {
            arena::init_for_testing(ts::ctx(scenario));
            character::init_for_testing(ts::ctx(scenario));
        };
        ts::next_tx(scenario, ALICE);
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        // Pinned at a high enough value that adding timeout deltas
        // doesn't underflow expiry assertions.
        clock::set_for_testing(&mut clock, 1_700_000_000_000);
        clock
    }

    fun mint_sui(scenario: &mut ts::Scenario, amount: u64): coin::Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(scenario))
    }

    /// Mint a character for `owner` (5/5/5/5 stat split, level 1).
    /// Returns the new Character's ID.
    fun mint_character(
        scenario: &mut ts::Scenario,
        owner: address,
        clock: &Clock,
    ): ID {
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

    /// Mint + bump to `level`. Pass level=1 for default.
    fun mint_character_at_level(
        scenario: &mut ts::Scenario,
        owner: address,
        level: u8,
        clock: &Clock,
    ): ID {
        let id = mint_character(scenario, owner, clock);
        if (level > 1) {
            ts::next_tx(scenario, owner);
            let mut character = ts::take_shared_by_id<Character>(scenario, id);
            character::set_level_for_testing(&mut character, level);
            ts::return_shared(character);
        };
        id
    }

    /// Shorthand: create_wager. Owner must have a character `char_id` already.
    fun create_wager_helper(
        scenario: &mut ts::Scenario,
        owner: address,
        char_id: ID,
        stake_amount: u64,
        clock: &Clock,
    ) {
        ts::next_tx(scenario, owner);
        let mut wager_registry = ts::take_shared<OpenWagerRegistry>(scenario);
        let character = ts::take_shared_by_id<Character>(scenario, char_id);
        let stake = mint_sui(scenario, stake_amount);
        arena::create_wager(stake, &character, &mut wager_registry, clock, ts::ctx(scenario));
        ts::return_shared(character);
        ts::return_shared(wager_registry);
    }

    /// Shorthand: challenger requests to accept.
    fun request_accept_helper(
        scenario: &mut ts::Scenario,
        challenger: address,
        char_id: ID,
        stake_amount: u64,
        clock: &Clock,
    ) {
        ts::next_tx(scenario, challenger);
        let mut wager = ts::take_shared<WagerMatch>(scenario);
        let wager_registry = ts::take_shared<OpenWagerRegistry>(scenario);
        let character = ts::take_shared_by_id<Character>(scenario, char_id);
        let stake = mint_sui(scenario, stake_amount);
        arena::request_accept_wager(
            &mut wager,
            stake,
            &character,
            &wager_registry,
            clock,
            ts::ctx(scenario),
        );
        ts::return_shared(character);
        ts::return_shared(wager_registry);
        ts::return_shared(wager);
    }

    fun approve_helper(scenario: &mut ts::Scenario, creator: address, clock: &Clock) {
        ts::next_tx(scenario, creator);
        let mut wager = ts::take_shared<WagerMatch>(scenario);
        arena::approve_challenger(&mut wager, clock, ts::ctx(scenario));
        ts::return_shared(wager);
    }

    fun decline_helper(scenario: &mut ts::Scenario, creator: address) {
        ts::next_tx(scenario, creator);
        let mut wager = ts::take_shared<WagerMatch>(scenario);
        arena::decline_challenger(&mut wager, ts::ctx(scenario));
        ts::return_shared(wager);
    }

    fun withdraw_helper(scenario: &mut ts::Scenario, challenger: address) {
        ts::next_tx(scenario, challenger);
        let mut wager = ts::take_shared<WagerMatch>(scenario);
        arena::withdraw_challenge(&mut wager, ts::ctx(scenario));
        ts::return_shared(wager);
    }

    // ==========================================================
    // Group 1 — Level bracket (codes 12, 22)
    // ==========================================================

    /// L1 creator + L2 challenger → ok (+1, exactly at bracket).
    #[test]
    fun test_level_bracket_plus_one_ok() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 2, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::status(&wager) == arena::status_pending_approval(), 0);
            assert!(arena::challenger_escrow_value(&wager) == STAKE_1_SUI, 1);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// L2 creator + L1 challenger → ok (-1, exactly at bracket).
    #[test]
    fun test_level_bracket_minus_one_ok() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 2, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// L3 creator + L3 challenger → ok (equal).
    #[test]
    fun test_level_bracket_equal_ok() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 3, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 3, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// L1 creator + L3 challenger → aborts ELevelOutOfBracket (+2).
    #[test]
    #[expected_failure(abort_code = 12, location = sui_combats::arena)]
    fun test_level_bracket_plus_two_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 3, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// L5 creator + L1 challenger → aborts ELevelOutOfBracket (-4).
    #[test]
    #[expected_failure(abort_code = 12, location = sui_combats::arena)]
    fun test_level_bracket_minus_four_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 5, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// create_wager with a Character owned by someone else aborts ENotCharacterOwner (22).
    #[test]
    #[expected_failure(abort_code = 22, location = sui_combats::arena)]
    fun test_create_wager_with_borrowed_character_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);

        // BOB tries to create_wager passing ALICE's character — anti-spoofing.
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let alice_character = ts::take_shared_by_id<Character>(&scenario, alice_char);
            let stake = mint_sui(&mut scenario, STAKE_1_SUI);
            arena::create_wager(
                stake,
                &alice_character,
                &mut wager_registry,
                &clock,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(alice_character);
            ts::return_shared(wager_registry);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// request_accept_wager with a Character owned by someone else aborts
    /// ENotCharacterOwner (22). Anti-spoofing on the challenger side.
    #[test]
    #[expected_failure(abort_code = 22, location = sui_combats::arena)]
    fun test_request_with_borrowed_character_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);

        // EVE tries to request_accept_wager passing BOB's character.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let bob_character = ts::take_shared_by_id<Character>(&scenario, bob_char);
            let stake = mint_sui(&mut scenario, STAKE_1_SUI);
            arena::request_accept_wager(
                &mut wager,
                stake,
                &bob_character,
                &wager_registry,
                &clock,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(bob_character);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 2 — State machine happy paths
    // ==========================================================

    /// Full v5.2 lifecycle: create → request → approve → settle.
    #[test]
    fun test_full_v52_lifecycle() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);

        // WAITING.
        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::status(&wager) == 0, 0);  // WAITING
            assert!(arena::player_a_level(&wager) == 1, 1);
            assert!(arena::escrow_value(&wager) == STAKE_1_SUI, 2);
            assert!(arena::challenger_escrow_value(&wager) == 0, 3);
            ts::return_shared(wager);
        };

        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        // PENDING_APPROVAL.
        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::status(&wager) == arena::status_pending_approval(), 4);
            assert!(arena::escrow_value(&wager) == STAKE_1_SUI, 5);  // creator's stake only
            assert!(arena::challenger_escrow_value(&wager) == STAKE_1_SUI, 6);  // challenger's
            assert!(option::is_some(&arena::pending_challenger(&wager)), 7);
            assert!(arena::pending_at(&wager) > 0, 8);
            assert!(option::is_none(&arena::player_b(&wager)), 9);
            ts::return_shared(wager);
        };

        approve_helper(&mut scenario, ALICE, &clock);

        // ACTIVE.
        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::status(&wager) == 1, 10);  // ACTIVE
            assert!(arena::escrow_value(&wager) == 2 * STAKE_1_SUI, 11);  // merged
            assert!(arena::challenger_escrow_value(&wager) == 0, 12);  // emptied
            assert!(option::is_none(&arena::pending_challenger(&wager)), 13);
            assert!(arena::pending_at(&wager) == 0, 14);
            assert!(option::is_some(&arena::player_b(&wager)), 15);
            assert!(*option::borrow(&arena::player_b(&wager)) == BOB, 16);
            assert!(arena::accepted_at(&wager) > 0, 17);
            ts::return_shared(wager);
        };

        // Settle.
        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 18);
            assert!(!arena::registry_has(&wager_registry, ALICE), 19);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// Decline returns to WAITING with the challenger refunded; second
    /// challenger can then request and be approved.
    #[test]
    fun test_decline_then_rerequest_then_approve() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        let carol_char = mint_character_at_level(&mut scenario, CAROL, 1, &clock);

        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        decline_helper(&mut scenario, ALICE);

        // Back to WAITING, slot cleared, challenger refunded.
        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::status(&wager) == 0, 0);  // WAITING
            assert!(arena::challenger_escrow_value(&wager) == 0, 1);
            assert!(option::is_none(&arena::pending_challenger(&wager)), 2);
            ts::return_shared(wager);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == STAKE_1_SUI, 3);
            ts::return_to_sender(&scenario, refund);
        };

        // CAROL now requests; ALICE approves.
        request_accept_helper(&mut scenario, CAROL, carol_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::status(&wager) == 1, 4);  // ACTIVE
            assert!(*option::borrow(&arena::player_b(&wager)) == CAROL, 5);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// Withdraw returns to WAITING with the challenger refunded.
    #[test]
    fun test_withdraw_returns_to_waiting() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        withdraw_helper(&mut scenario, BOB);

        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::status(&wager) == 0, 0);  // WAITING
            assert!(arena::challenger_escrow_value(&wager) == 0, 1);
            assert!(option::is_none(&arena::pending_challenger(&wager)), 2);
            ts::return_shared(wager);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == STAKE_1_SUI, 3);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 3 — Invalid transitions (code 13: ENotPendingApproval)
    // ==========================================================

    /// approve in WAITING aborts ENotPendingApproval (13).
    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::arena)]
    fun test_approve_in_waiting_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// decline in WAITING aborts ENotPendingApproval (13).
    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::arena)]
    fun test_decline_in_waiting_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        decline_helper(&mut scenario, ALICE);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// withdraw in WAITING aborts ENotPendingApproval (13).
    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::arena)]
    fun test_withdraw_in_waiting_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        withdraw_helper(&mut scenario, BOB);  // any sender; status check fires first
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// cancel_expired_challenge in WAITING aborts ENotPendingApproval (13).
    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::arena)]
    fun test_cancel_expired_challenge_in_waiting_aborts() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);

        // Time-jump past CHALLENGE_TIMEOUT_MS so the timing assertion would
        // pass — but we expect the STATUS check to fire first.
        clock::increment_for_testing(&mut clock, arena::challenge_timeout_ms() + 1);

        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::cancel_expired_challenge(&mut wager, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// approve after settle (status SETTLED) aborts ENotPendingApproval (13).
    #[test]
    #[expected_failure(abort_code = 13, location = sui_combats::arena)]
    fun test_approve_after_settle_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };

        approve_helper(&mut scenario, ALICE, &clock);  // aborts — status SETTLED
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 4 — Concurrency / dup-state
    // ==========================================================

    // NOTE: EChallengerSlotTaken (14) is belt-and-suspenders. With an
    // intact state machine, request_accept_wager's status==WAITING check
    // fires first because request also moves status to PENDING_APPROVAL.
    // Code 14 only catches a hypothetical state where status==WAITING but
    // pending_challenger==Some — unreachable from the public API. We
    // verify the realistic user-facing failure (EMatchNotWaiting fires
    // first) here. Code 14 stays in the source as defence-in-depth and
    // is documented in the deploy log § "Unreachable abort codes".

    /// Second request after pending → EMatchNotWaiting (1) fires first
    /// per spec §7.2 assertion order (status check before slot check).
    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::arena)]
    fun test_request_after_pending_fires_match_not_waiting_first() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        let carol_char = mint_character_at_level(&mut scenario, CAROL, 1, &clock);

        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, CAROL, carol_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// Direct EChallengerSlotTaken (14) coverage via test-only state
    /// mutation. We force the unreachable-by-construction shape
    /// (status=WAITING, pending_challenger=Some) and call
    /// request_accept_wager again — verifies the defensive assertion
    /// is wired correctly even though normal callers will never hit it.
    #[test]
    #[expected_failure(abort_code = 14, location = sui_combats::arena)]
    fun test_request_with_slot_taken_aborts_when_forced() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        let carol_char = mint_character_at_level(&mut scenario, CAROL, 1, &clock);

        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        // Forge the impossible-via-public-API state: status WAITING with
        // pending_challenger still Some.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::force_status_for_testing(&mut wager, 0);  // STATUS_WAITING
            ts::return_shared(wager);
        };

        // CAROL requests — status=WAITING passes; slot-taken assertion fires.
        request_accept_helper(&mut scenario, CAROL, carol_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 5 — Authority (codes 15, 16)
    // ==========================================================

    /// approve_challenger by non-creator aborts ENotCreatorForApproval (15).
    #[test]
    #[expected_failure(abort_code = 15, location = sui_combats::arena)]
    fun test_approve_by_non_creator_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, BOB, &clock);  // BOB is challenger, not creator
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// decline_challenger by non-creator aborts ENotCreatorForApproval (15).
    #[test]
    #[expected_failure(abort_code = 15, location = sui_combats::arena)]
    fun test_decline_by_non_creator_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        decline_helper(&mut scenario, EVE);  // EVE is neither creator nor challenger
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// withdraw_challenge by non-pending-challenger aborts ENotPendingChallenger (16).
    #[test]
    #[expected_failure(abort_code = 16, location = sui_combats::arena)]
    fun test_withdraw_by_non_pending_challenger_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        withdraw_helper(&mut scenario, EVE);  // EVE isn't the pending challenger
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// request_accept_wager as creator → EAlreadyHasOpenWager (11) fires before
    /// ECannotJoinOwnMatch (7), because creator is in the registry.
    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::arena)]
    fun test_creator_request_own_aborts_already_open() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 6 — Challenge timeout (code 17: EChallengeNotExpired)
    // ==========================================================

    /// cancel_expired_challenge before timeout aborts EChallengeNotExpired (17).
    #[test]
    #[expected_failure(abort_code = 17, location = sui_combats::arena)]
    fun test_cancel_expired_challenge_too_early_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        // Don't advance the clock — cancel_expired_challenge fires immediately.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::cancel_expired_challenge(&mut wager, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// cancel_expired_challenge after timeout — works; anyone can call.
    #[test]
    fun test_cancel_expired_challenge_after_timeout_works() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        clock::increment_for_testing(&mut clock, arena::challenge_timeout_ms() + 1);

        // EVE (a stranger) calls cancel_expired_challenge.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::cancel_expired_challenge(&mut wager, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 0, 0);  // back to WAITING
            assert!(arena::challenger_escrow_value(&wager) == 0, 1);
            assert!(option::is_none(&arena::pending_challenger(&wager)), 2);
            ts::return_shared(wager);
        };

        // BOB receives his stake back.
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == STAKE_1_SUI, 3);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 7 — Funds invariants (no stranded escrow)
    // ==========================================================

    /// approve merges escrows without losing MIST.
    #[test]
    fun test_approve_merges_without_mist_loss() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        let odd_stake: u64 = 777_777_777;  // odd MIST
        create_wager_helper(&mut scenario, ALICE, alice_char, odd_stake, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, odd_stake, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, ALICE);
        {
            let wager = ts::take_shared<WagerMatch>(&scenario);
            assert!(arena::escrow_value(&wager) == 2 * odd_stake, 0);
            assert!(arena::challenger_escrow_value(&wager) == 0, 1);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// decline refunds challenger exactly their stake.
    #[test]
    fun test_decline_refunds_exact_stake() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        let odd_stake: u64 = 333_333_333;
        create_wager_helper(&mut scenario, ALICE, alice_char, odd_stake, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, odd_stake, &clock);
        decline_helper(&mut scenario, ALICE);

        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == odd_stake, 0);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// withdraw refunds challenger exactly their stake.
    #[test]
    fun test_withdraw_refunds_exact_stake() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        let odd_stake: u64 = 123_456_789;
        create_wager_helper(&mut scenario, ALICE, alice_char, odd_stake, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, odd_stake, &clock);
        withdraw_helper(&mut scenario, BOB);

        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == odd_stake, 0);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// admin_cancel on PENDING_APPROVAL refunds creator AND challenger their
    /// own stakes (no merge); creator removed from registry.
    #[test]
    fun test_admin_cancel_on_pending_approval_refunds_both() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        let creator_stake: u64 = 999_999_999;
        create_wager_helper(&mut scenario, ALICE, alice_char, creator_stake, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, creator_stake, &clock);

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::admin_cancel_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);  // SETTLED
            assert!(arena::escrow_value(&wager) == 0, 1);
            assert!(arena::challenger_escrow_value(&wager) == 0, 2);
            assert!(!arena::registry_has(&wager_registry, ALICE), 3);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == creator_stake, 4);
            ts::return_to_sender(&scenario, refund);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == creator_stake, 5);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 8 — Stake validation
    // ==========================================================

    /// Stake mismatch on request_accept_wager → EStakeMismatch (3).
    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::arena)]
    fun test_request_with_wrong_stake_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI / 2, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 9 — v5.1 compat (existing functions unchanged)
    // ==========================================================

    /// settle_tie still works after the new request/approve flow.
    #[test]
    fun test_settle_tie_after_v52_flow() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_tie(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);
            assert!(arena::escrow_value(&wager) == 0, 1);
            assert!(!arena::registry_has(&wager_registry, ALICE), 2);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == STAKE_1_SUI, 3);
            ts::return_to_sender(&scenario, refund);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == STAKE_1_SUI, 4);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// settle_tie on PENDING_APPROVAL aborts EMatchNotActive (2) — NOT
    /// ENotActiveForReclaim. v5.1 codes stay put for v5.1 functions.
    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::arena)]
    fun test_settle_tie_on_pending_aborts_match_not_active() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_tie(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// cancel_wager from PENDING_APPROVAL aborts EMatchNotWaiting (1) — creator
    /// must decline first to return to WAITING.
    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::arena)]
    fun test_cancel_wager_on_pending_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// Decline then cancel — the documented two-tx flow for cancelling a
    /// PENDING_APPROVAL wager.
    #[test]
    fun test_decline_then_cancel_works() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        decline_helper(&mut scenario, ALICE);

        // Now cancel from WAITING.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);
            assert!(!arena::registry_has(&wager_registry, ALICE), 1);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// cancel_wager by non-creator still aborts ENotPlayerA (4).
    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::arena)]
    fun test_cancel_wager_non_creator_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// Duplicate create_wager → EAlreadyHasOpenWager (11).
    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::arena)]
    fun test_create_wager_duplicate_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// request_accept_wager by a wallet that itself has an open wager →
    /// EAlreadyHasOpenWager (11). Preserves v5.1's
    /// chain-side single-open-wager guarantee.
    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::arena)]
    fun test_request_when_already_creator_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        create_wager_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI / 2, &clock);

        // BOB now tries to ALSO request-accept ALICE's wager.
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// settle_wager non-treasury still aborts EUnauthorized (8).
    #[test]
    #[expected_failure(abort_code = 8, location = sui_combats::arena)]
    fun test_settle_non_treasury_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// settle_wager with non-participant winner aborts EInvalidWinner (5).
    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::arena)]
    fun test_settle_with_non_participant_winner_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, EVE, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// cancel_expired_wager on WAITING after timeout works.
    #[test]
    fun test_cancel_expired_waiting_after_timeout() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI / 2, &clock);

        clock::increment_for_testing(&mut clock, 700_000);  // > MATCH_EXPIRY_MS (10 min)

        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_expired_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);
            assert!(!arena::registry_has(&wager_registry, ALICE), 1);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// admin_cancel_wager after settle aborts EMatchAlreadySettled (6).
    #[test]
    #[expected_failure(abort_code = 6, location = sui_combats::arena)]
    fun test_admin_cancel_after_settle_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        // Now admin_cancel — aborts EMatchAlreadySettled.
        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::admin_cancel_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// cancel_expired_wager before MATCH_EXPIRY_MS aborts ENotExpired (9).
    #[test]
    #[expected_failure(abort_code = 9, location = sui_combats::arena)]
    fun test_cancel_expired_wager_too_early_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI / 2, &clock);

        // No clock advance — cancel_expired_wager fires too early.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_expired_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// admin_cancel_wager on ACTIVE splits 50/50 (unchanged from v5.1).
    #[test]
    fun test_admin_cancel_active_splits_50_50() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::admin_cancel_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        ts::next_tx(&mut scenario, ALICE);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == STAKE_1_SUI, 1);
            ts::return_to_sender(&scenario, refund);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == STAKE_1_SUI, 2);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 10 — Fight-lock defence (code 21: ECreatorFightLocked)
    // ==========================================================

    /// create_wager when creator's character is fight-locked aborts
    /// ECreatorFightLocked (21).
    #[test]
    #[expected_failure(abort_code = 21, location = sui_combats::arena)]
    fun test_create_wager_while_fight_locked_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);

        // ALICE locks her character (she's the AdminCap holder from init).
        ts::next_tx(&mut scenario, ALICE);
        {
            let admin_cap = ts::take_from_sender<character::AdminCap>(&scenario);
            let mut character = ts::take_shared_by_id<Character>(&scenario, alice_char);
            // Lock for 30 minutes from now — well within MAX_LOCK_MS.
            let now = clock::timestamp_ms(&clock);
            character::set_fight_lock(&admin_cap, &mut character, now + 1_800_000, &clock);
            ts::return_shared(character);
            ts::return_to_sender(&scenario, admin_cap);
        };

        // Now try to create a wager — should abort ECreatorFightLocked.
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ==========================================================
    // Group 11 — Referee-liveness escape hatch (codes 18, 19, 20)
    // ==========================================================

    /// reclaim_stalled_wager by player_a after timeout: refunds each side
    /// their original stake, status SETTLED, registry cleared. Pure escrow
    /// unwind, no platform fee.
    #[test]
    fun test_reclaim_stalled_wager_by_player_a() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        let stake: u64 = 555_555_555;
        create_wager_helper(&mut scenario, ALICE, alice_char, stake, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, stake, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        // Fast-forward past WAGER_RESOLUTION_TIMEOUT_MS.
        clock::increment_for_testing(&mut clock, arena::wager_resolution_timeout_ms() + 1);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);  // SETTLED
            assert!(arena::escrow_value(&wager) == 0, 1);
            assert!(!arena::registry_has(&wager_registry, ALICE), 2);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };

        // Both sides receive their original stake.
        ts::next_tx(&mut scenario, ALICE);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == stake, 3);
            ts::return_to_sender(&scenario, refund);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == stake, 4);
            ts::return_to_sender(&scenario, refund);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// reclaim by player_b after timeout: same outcome — either participant
    /// can fire the escape hatch.
    #[test]
    fun test_reclaim_stalled_wager_by_player_b() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);

        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        clock::increment_for_testing(&mut clock, arena::wager_resolution_timeout_ms() + 1);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// reclaim before WAGER_RESOLUTION_TIMEOUT_MS aborts EWagerNotStalled (19).
    /// THE critical anti-abuse gate — a losing player must not be able to
    /// reclaim mid-fight to escape a loss.
    #[test]
    #[expected_failure(abort_code = 19, location = sui_combats::arena)]
    fun test_reclaim_too_early_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        // No clock advance — try to reclaim immediately.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// reclaim by a non-participant aborts ENotWagerParticipant (20).
    #[test]
    #[expected_failure(abort_code = 20, location = sui_combats::arena)]
    fun test_reclaim_by_non_participant_aborts() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        clock::increment_for_testing(&mut clock, arena::wager_resolution_timeout_ms() + 1);

        // EVE (neither player_a nor player_b) tries to reclaim.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// reclaim on WAITING aborts ENotActiveForReclaim (18) — distinct from
    /// settle_wager's EMatchNotActive (2).
    #[test]
    #[expected_failure(abort_code = 18, location = sui_combats::arena)]
    fun test_reclaim_on_waiting_aborts() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);

        clock::increment_for_testing(&mut clock, arena::wager_resolution_timeout_ms() + 1);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// reclaim on PENDING_APPROVAL aborts ENotActiveForReclaim (18).
    #[test]
    #[expected_failure(abort_code = 18, location = sui_combats::arena)]
    fun test_reclaim_on_pending_approval_aborts() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);

        clock::increment_for_testing(&mut clock, arena::wager_resolution_timeout_ms() + 1);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// Second reclaim after success aborts ENotActiveForReclaim (18) — wager
    /// is now SETTLED.
    #[test]
    #[expected_failure(abort_code = 18, location = sui_combats::arena)]
    fun test_double_reclaim_aborts() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        clock::increment_for_testing(&mut clock, arena::wager_resolution_timeout_ms() + 1);

        // First reclaim succeeds.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        // Second reclaim — aborts.
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::reclaim_stalled_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    /// cancel_expired_wager still callable on ACTIVE pre-reclaim — proves
    /// the permissionless 10-min backstop and the participant 30-min escape
    /// hatch coexist (no mutual exclusion). Permissionless usually fires
    /// first; both paths terminate safely.
    #[test]
    fun test_cancel_expired_active_still_works_pre_reclaim() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);
        let alice_char = mint_character_at_level(&mut scenario, ALICE, 1, &clock);
        let bob_char = mint_character_at_level(&mut scenario, BOB, 1, &clock);
        create_wager_helper(&mut scenario, ALICE, alice_char, STAKE_1_SUI, &clock);
        request_accept_helper(&mut scenario, BOB, bob_char, STAKE_1_SUI, &clock);
        approve_helper(&mut scenario, ALICE, &clock);

        // Past SETTLEMENT_TIMEOUT_MS (10 min) but BEFORE
        // WAGER_RESOLUTION_TIMEOUT_MS (30 min). cancel_expired_wager fires.
        clock::increment_for_testing(&mut clock, 700_000);  // 11.6 min

        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut wager_registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_expired_wager(&mut wager, &mut wager_registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);  // SETTLED (50/50 split)
            ts::return_shared(wager_registry);
            ts::return_shared(wager);
        };
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
