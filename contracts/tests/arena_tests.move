#[test_only]
module sui_combats::arena_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::sui::SUI;

    use sui_combats::arena::{Self, WagerMatch, OpenWagerRegistry, init_for_testing};

    /// TREASURY in arena.move is hardcoded to the v5 publisher wallet.
    const TREASURY: address = @0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d;
    const ALICE: address = @0xA;
    const BOB:   address = @0xB;
    const EVE:   address = @0xE;

    fun bootstrap(scenario: &mut ts::Scenario): Clock {
        ts::next_tx(scenario, ALICE);
        { init_for_testing(ts::ctx(scenario)); };

        ts::next_tx(scenario, ALICE);
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, 1_700_000_000_000);
        clock
    }

    fun mint_sui(scenario: &mut ts::Scenario, amount: u64): coin::Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(scenario))
    }

    // ──────── Full lifecycle: create → accept → settle ────────

    #[test]
    fun test_full_wager_lifecycle() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::registry_has(&registry, ALICE), 0);
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 1, 1);  // STATUS_ACTIVE
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 2);  // STATUS_SETTLED
            assert!(arena::settled_at(&wager) > 0, 3);
            // v5.1 — creator removed from registry after settle.
            assert!(!arena::registry_has(&registry, ALICE), 4);
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Winner-not-participant rejection ────────

    #[test]
    #[expected_failure(abort_code = 5, location = sui_combats::arena)]  // EInvalidWinner
    fun test_settle_with_non_participant_winner_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, EVE, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Settle without TREASURY auth ────────

    #[test]
    #[expected_failure(abort_code = 8, location = sui_combats::arena)]  // EUnauthorized
    fun test_settle_non_treasury_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Cancel by non-creator ────────

    #[test]
    #[expected_failure(abort_code = 4, location = sui_combats::arena)]  // ENotPlayerA
    fun test_cancel_non_creator_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_wager(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Cannot accept own wager ────────
    //
    // v5.1 — Because the creator is in OpenWagerRegistry, the registry check
    // fires first with EAlreadyHasOpenWager (11). ECannotJoinOwnMatch (7)
    // remains in the code as belt-and-suspenders for a theoretical
    // creator-not-in-registry case that shouldn't be reachable.

    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::arena)]  // EAlreadyHasOpenWager (v5.1)
    fun test_cannot_accept_own_wager() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Double-accept aborts with EMatchNotWaiting ────────

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::arena)]  // EMatchNotWaiting
    fun test_double_accept_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Cancel-after-accept aborts ────────

    #[test]
    #[expected_failure(abort_code = 1, location = sui_combats::arena)]  // EMatchNotWaiting
    fun test_cancel_after_accept_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_wager(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Stake mismatch on accept ────────

    #[test]
    #[expected_failure(abort_code = 3, location = sui_combats::arena)]  // EStakeMismatch
    fun test_accept_with_wrong_stake_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — OpenWagerRegistry: duplicate create aborts ────────

    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::arena)]  // EAlreadyHasOpenWager
    fun test_create_wager_duplicate_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        // ALICE tries to create a second wager — aborts.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — OpenWagerRegistry: acceptor-with-open-wager aborts ────────

    #[test]
    #[expected_failure(abort_code = 11, location = sui_combats::arena)]  // EAlreadyHasOpenWager
    fun test_accept_when_acceptor_has_open_wager_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        // ALICE creates a wager.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        // BOB also creates a wager.
        ts::next_tx(&mut scenario, BOB);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 200_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        // BOB now tries to ALSO accept ALICE's wager — closes the silent-accept
        // bug path at the chain level.
        ts::next_tx(&mut scenario, BOB);
        {
            // Take Alice's wager (the first shared object); Bob's would also
            // be takeable but the test_scenario take_shared returns one match.
            // Using take_shared_by_id would be cleaner if we had the id; for
            // this test, the abort fires regardless of which wager Bob targets.
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — settle_tie 100% refund both sides ────────

    #[test]
    fun test_settle_tie_refunds_both_sides() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        // ALICE creates 1 SUI wager.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        // BOB accepts with matching 1 SUI.
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::escrow_value(&wager) == 2_000_000_000, 0);
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        // TREASURY settles as tie.
        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_tie(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 1);  // SETTLED
            assert!(arena::escrow_value(&wager) == 0, 2);  // emptied
            assert!(!arena::registry_has(&registry, ALICE), 3);  // creator removed
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        // ALICE receives her 1 SUI back (no platform fee on draws).
        ts::next_tx(&mut scenario, ALICE);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == 1_000_000_000, 4);
            ts::return_to_sender(&scenario, refund);
        };

        // BOB receives his 1 SUI back.
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == 1_000_000_000, 5);
            ts::return_to_sender(&scenario, refund);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — settle_tie requires TREASURY ────────

    #[test]
    #[expected_failure(abort_code = 8, location = sui_combats::arena)]  // EUnauthorized
    fun test_settle_tie_non_treasury_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        // EVE (not TREASURY) tries to settle_tie.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_tie(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — settle_tie on WAITING wager aborts ────────

    #[test]
    #[expected_failure(abort_code = 2, location = sui_combats::arena)]  // EMatchNotActive
    fun test_settle_tie_on_waiting_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        // Skip accept — wager stays WAITING.
        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::settle_tie(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── v5.1 — cancel_wager removes from registry ────────

    #[test]
    fun test_cancel_wager_clears_registry() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::registry_has(&registry, ALICE), 0);
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_wager(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(!arena::registry_has(&registry, ALICE), 1);
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        // ALICE can now create a fresh wager on the same wallet.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 200_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::registry_has(&registry, ALICE), 2);
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── cancel_expired_wager — WAITING + timeout ────────

    #[test]
    fun test_cancel_expired_waiting_after_timeout() {
        let mut scenario = ts::begin(ALICE);
        let mut clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 200_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        // Fast-forward past MATCH_EXPIRY_MS (10 min).
        clock::increment_for_testing(&mut clock, 700_000);

        // Anyone (EVE) can call cancel_expired_wager now.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_expired_wager(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);
            assert!(!arena::registry_has(&registry, ALICE), 1);
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 9, location = sui_combats::arena)]  // ENotExpired
    fun test_cancel_expired_too_early_aborts() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 200_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        // Try to cancel before expiry — aborts.
        ts::next_tx(&mut scenario, EVE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::cancel_expired_wager(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── admin_cancel_wager — ACTIVE 50/50 ────────

    #[test]
    fun test_admin_cancel_active_splits_50_50() {
        let mut scenario = ts::begin(ALICE);
        let clock = bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &mut registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &registry, &clock, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let mut registry = ts::take_shared<OpenWagerRegistry>(&scenario);
            arena::admin_cancel_wager(&mut wager, &mut registry, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 0);
            ts::return_shared(registry);
            ts::return_shared(wager);
        };

        // ALICE and BOB each get 0.5 SUI back (no fee on admin_cancel ACTIVE).
        ts::next_tx(&mut scenario, ALICE);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            // The escrow holds 2 SUI; half is 1 SUI to each side.
            assert!(coin::value(&refund) == 1_000_000_000, 1);
            ts::return_to_sender(&scenario, refund);
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == 1_000_000_000, 2);
            ts::return_to_sender(&scenario, refund);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
