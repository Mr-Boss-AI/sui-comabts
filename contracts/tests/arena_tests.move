#[test_only]
module sui_combats::arena_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::sui::SUI;

    use sui_combats::arena::{Self, WagerMatch};

    /// TREASURY in arena.move is hardcoded to the v5 publisher wallet.
    const TREASURY: address = @0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d;
    const ALICE: address = @0xA;
    const BOB:   address = @0xB;
    const EVE:   address = @0xE;  // attempted-cheater

    fun setup_clock(scenario: &mut ts::Scenario): Clock {
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
        let clock = setup_clock(&mut scenario);

        // ALICE creates wager (1 SUI)
        ts::next_tx(&mut scenario, ALICE);
        {
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &clock, ts::ctx(&mut scenario));
        };

        // BOB accepts
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 1, 0);  // STATUS_ACTIVE
            ts::return_shared(wager);
        };

        // TREASURY settles — ALICE wins
        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &clock, ts::ctx(&mut scenario));
            assert!(arena::status(&wager) == 2, 1);  // STATUS_SETTLED
            assert!(arena::settled_at(&wager) > 0, 2);
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
        let clock = setup_clock(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &clock, ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager);
        };

        // TREASURY tries to send funds to EVE who never played — must abort
        ts::next_tx(&mut scenario, TREASURY);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::settle_wager(&mut wager, EVE, &clock, ts::ctx(&mut scenario));
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
        let clock = setup_clock(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &clock, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::accept_wager(&mut wager, stake, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager);
        };

        // ALICE (not TREASURY) tries to settle in her favor
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::settle_wager(&mut wager, ALICE, &clock, ts::ctx(&mut scenario));
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
        let clock = setup_clock(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &clock, ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            arena::cancel_wager(&mut wager, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ──────── Cannot accept own wager ────────

    #[test]
    #[expected_failure(abort_code = 7, location = sui_combats::arena)]  // ECannotJoinOwnMatch
    fun test_cannot_accept_own_wager() {
        let mut scenario = ts::begin(ALICE);
        let clock = setup_clock(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::create_wager(stake, &clock, ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &clock, ts::ctx(&mut scenario));
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
        let clock = setup_clock(&mut scenario);

        ts::next_tx(&mut scenario, ALICE);
        {
            let stake = mint_sui(&mut scenario, 1_000_000_000);
            arena::create_wager(stake, &clock, ts::ctx(&mut scenario));
        };

        // BOB tries to join with half the stake
        ts::next_tx(&mut scenario, BOB);
        {
            let mut wager = ts::take_shared<WagerMatch>(&scenario);
            let stake = mint_sui(&mut scenario, 500_000_000);
            arena::accept_wager(&mut wager, stake, &clock, ts::ctx(&mut scenario));
            ts::return_shared(wager);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
