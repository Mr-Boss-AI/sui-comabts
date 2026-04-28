module sui_combats::arena {
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};

    // ===== Error constants =====
    const EInvalidStake: u64 = 0;
    const EMatchNotWaiting: u64 = 1;
    const EMatchNotActive: u64 = 2;
    const EStakeMismatch: u64 = 3;
    const ENotPlayerA: u64 = 4;
    const EInvalidWinner: u64 = 5;
    const EMatchAlreadySettled: u64 = 6;
    const ECannotJoinOwnMatch: u64 = 7;
    const EUnauthorized: u64 = 8;
    const ENotExpired: u64 = 9;
    const ENoOpponent: u64 = 10;

    // ===== Status constants =====
    const STATUS_WAITING: u8 = 0;
    const STATUS_ACTIVE: u8 = 1;
    const STATUS_SETTLED: u8 = 2;

    // ===== Platform fee (5%) =====
    const PLATFORM_FEE_BPS: u64 = 500;
    const BPS_BASE: u64 = 10_000;

    // ===== Timeouts =====
    const MATCH_EXPIRY_MS: u64 = 600_000;        // 10 min — unaccepted wager auto-refunds
    const SETTLEMENT_TIMEOUT_MS: u64 = 600_000;  // 10 min after accept — unsettled splits 50/50

    // ===== TREASURY — receives 5% platform fee + can settle / admin-cancel.
    // Hardcoded to the v5 publisher wallet. A change requires a fresh publish.
    const TREASURY: address = @0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d;

    // ===== WagerMatch (shared) =====
    public struct WagerMatch has key {
        id: UID,
        player_a: address,
        player_b: Option<address>,
        stake_amount: u64,
        escrow: Balance<SUI>,
        status: u8,
        created_at: u64,
        accepted_at: u64,
        settled_at: u64,
    }

    // ===== Events =====
    public struct WagerCreated has copy, drop {
        match_id: ID,
        player_a: address,
        stake_amount: u64,
    }

    public struct WagerAccepted has copy, drop {
        match_id: ID,
        player_a: address,
        player_b: address,
        total_stake: u64,
    }

    public struct WagerSettled has copy, drop {
        match_id: ID,
        winner: address,
        payout: u64,
        platform_fee: u64,
    }

    public struct WagerCancelled has copy, drop {
        match_id: ID,
        player_a: address,
        refund: u64,
    }

    public struct WagerRefunded has copy, drop {
        match_id: ID,
        player_a: address,
        player_b: address,
        refund_each: u64,
    }

    // ===== Public functions =====

    /// Create a new wager. Sender deposits `stake` into escrow; status starts WAITING.
    public fun create_wager(
        stake: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let stake_amount = coin::value(&stake);
        assert!(stake_amount > 0, EInvalidStake);

        let player_a = tx_context::sender(ctx);

        let wager = WagerMatch {
            id: object::new(ctx),
            player_a,
            player_b: option::none(),
            stake_amount,
            escrow: coin::into_balance(stake),
            status: STATUS_WAITING,
            created_at: clock::timestamp_ms(clock),
            accepted_at: 0,
            settled_at: 0,
        };

        let match_id = object::id(&wager);

        event::emit(WagerCreated { match_id, player_a, stake_amount });
        transfer::share_object(wager);
    }

    /// Player B joins by depositing matching stake. Status moves WAITING → ACTIVE.
    public fun accept_wager(
        wager: &mut WagerMatch,
        stake: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(wager.status == STATUS_WAITING, EMatchNotWaiting);

        let player_b = tx_context::sender(ctx);
        assert!(player_b != wager.player_a, ECannotJoinOwnMatch);

        let stake_value = coin::value(&stake);
        assert!(stake_value == wager.stake_amount, EStakeMismatch);

        balance::join(&mut wager.escrow, coin::into_balance(stake));
        wager.player_b = option::some(player_b);
        wager.status = STATUS_ACTIVE;
        wager.accepted_at = clock::timestamp_ms(clock);

        let match_id = object::id(wager);
        let total_stake = balance::value(&wager.escrow);

        event::emit(WagerAccepted {
            match_id,
            player_a: wager.player_a,
            player_b,
            total_stake,
        });
    }

    /// Settle a finished wager. TREASURY-only. `winner` MUST be one of the two
    /// participants. Splits escrow 95% to winner / 5% to TREASURY.
    public fun settle_wager(
        wager: &mut WagerMatch,
        winner: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == TREASURY, EUnauthorized);
        assert!(wager.status == STATUS_ACTIVE, EMatchNotActive);
        assert!(option::is_some(&wager.player_b), ENoOpponent);

        let player_b_addr = *option::borrow(&wager.player_b);
        assert!(
            winner == wager.player_a || winner == player_b_addr,
            EInvalidWinner,
        );

        let total = balance::value(&wager.escrow);
        let platform_fee = (total * PLATFORM_FEE_BPS) / BPS_BASE;
        let payout = total - platform_fee;

        let fee_balance = balance::split(&mut wager.escrow, platform_fee);
        let fee_coin = coin::from_balance(fee_balance, ctx);
        transfer::public_transfer(fee_coin, TREASURY);

        let winner_balance = balance::withdraw_all(&mut wager.escrow);
        let winner_coin = coin::from_balance(winner_balance, ctx);
        transfer::public_transfer(winner_coin, winner);

        wager.status = STATUS_SETTLED;
        wager.settled_at = clock::timestamp_ms(clock);

        let match_id = object::id(wager);

        event::emit(WagerSettled {
            match_id,
            winner,
            payout,
            platform_fee,
        });
    }

    /// Player A cancels their own unaccepted wager. WAITING-only.
    public fun cancel_wager(
        wager: &mut WagerMatch,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(wager.status == STATUS_WAITING, EMatchNotWaiting);

        let sender = tx_context::sender(ctx);
        assert!(sender == wager.player_a, ENotPlayerA);

        let refund_amount = balance::value(&wager.escrow);
        let refund_balance = balance::withdraw_all(&mut wager.escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, wager.player_a);

        wager.status = STATUS_SETTLED;
        wager.settled_at = clock::timestamp_ms(clock);

        let match_id = object::id(wager);

        event::emit(WagerCancelled {
            match_id,
            player_a: wager.player_a,
            refund: refund_amount,
        });
    }

    /// TREASURY can cancel any non-settled wager.
    /// WAITING: refund to player_a. ACTIVE: 50/50 split.
    public fun admin_cancel_wager(
        wager: &mut WagerMatch,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == TREASURY, EUnauthorized);
        assert!(wager.status != STATUS_SETTLED, EMatchAlreadySettled);

        let match_id = object::id(wager);
        let now = clock::timestamp_ms(clock);

        if (wager.status == STATUS_WAITING) {
            let refund_amount = balance::value(&wager.escrow);
            let refund_balance = balance::withdraw_all(&mut wager.escrow);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, wager.player_a);

            wager.status = STATUS_SETTLED;
            wager.settled_at = now;

            event::emit(WagerCancelled {
                match_id,
                player_a: wager.player_a,
                refund: refund_amount,
            });
        } else {
            // STATUS_ACTIVE — refund both sides equally
            assert!(option::is_some(&wager.player_b), ENoOpponent);
            let player_b_addr = *option::borrow(&wager.player_b);

            let total = balance::value(&wager.escrow);
            let half = total / 2;

            let balance_a = balance::split(&mut wager.escrow, half);
            let coin_a = coin::from_balance(balance_a, ctx);
            transfer::public_transfer(coin_a, wager.player_a);

            // Player B gets the rest (handles odd MIST cleanly)
            let balance_b = balance::withdraw_all(&mut wager.escrow);
            let coin_b = coin::from_balance(balance_b, ctx);
            transfer::public_transfer(coin_b, player_b_addr);

            wager.status = STATUS_SETTLED;
            wager.settled_at = now;

            event::emit(WagerRefunded {
                match_id,
                player_a: wager.player_a,
                player_b: player_b_addr,
                refund_each: half,
            });
        }
    }

    /// Anyone can refund an expired wager. Safety net if server is offline.
    /// WAITING + past MATCH_EXPIRY_MS: refund player_a.
    /// ACTIVE + past SETTLEMENT_TIMEOUT_MS: 50/50 split.
    public fun cancel_expired_wager(
        wager: &mut WagerMatch,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(wager.status != STATUS_SETTLED, EMatchAlreadySettled);

        let now = clock::timestamp_ms(clock);
        let match_id = object::id(wager);

        if (wager.status == STATUS_WAITING) {
            assert!(now >= wager.created_at + MATCH_EXPIRY_MS, ENotExpired);

            let refund_amount = balance::value(&wager.escrow);
            let refund_balance = balance::withdraw_all(&mut wager.escrow);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, wager.player_a);

            wager.status = STATUS_SETTLED;
            wager.settled_at = now;

            event::emit(WagerCancelled {
                match_id,
                player_a: wager.player_a,
                refund: refund_amount,
            });
        } else {
            // STATUS_ACTIVE — settlement timed out
            assert!(now >= wager.accepted_at + SETTLEMENT_TIMEOUT_MS, ENotExpired);
            assert!(option::is_some(&wager.player_b), ENoOpponent);
            let player_b_addr = *option::borrow(&wager.player_b);

            let total = balance::value(&wager.escrow);
            let half = total / 2;

            let balance_a = balance::split(&mut wager.escrow, half);
            let coin_a = coin::from_balance(balance_a, ctx);
            transfer::public_transfer(coin_a, wager.player_a);

            let balance_b = balance::withdraw_all(&mut wager.escrow);
            let coin_b = coin::from_balance(balance_b, ctx);
            transfer::public_transfer(coin_b, player_b_addr);

            wager.status = STATUS_SETTLED;
            wager.settled_at = now;

            event::emit(WagerRefunded {
                match_id,
                player_a: wager.player_a,
                player_b: player_b_addr,
                refund_each: half,
            });
        }
    }

    // ===== Read-only accessors =====
    public fun player_a(wager: &WagerMatch): address { wager.player_a }
    public fun player_b(wager: &WagerMatch): Option<address> { wager.player_b }
    public fun stake_amount(wager: &WagerMatch): u64 { wager.stake_amount }
    public fun status(wager: &WagerMatch): u8 { wager.status }
    public fun escrow_value(wager: &WagerMatch): u64 { balance::value(&wager.escrow) }
    public fun created_at(wager: &WagerMatch): u64 { wager.created_at }
    public fun accepted_at(wager: &WagerMatch): u64 { wager.accepted_at }
    public fun settled_at(wager: &WagerMatch): u64 { wager.settled_at }
    public fun treasury_address(): address { TREASURY }
}
