module sui_combats::arena {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use std::option::{Self, Option};

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

    // ===== Status constants =====
    const STATUS_WAITING: u8 = 0;
    const STATUS_ACTIVE: u8 = 1;
    const STATUS_SETTLED: u8 = 2;

    // ===== Platform fee =====
    const PLATFORM_FEE_BPS: u64 = 500;
    const BPS_BASE: u64 = 10000;

    // ===== Timeouts =====
    const MATCH_EXPIRY_MS: u64 = 600_000;       // 10 minutes — unaccepted wager expires
    const SETTLEMENT_TIMEOUT_MS: u64 = 600_000;  // 10 minutes after accept — unsettled wager expires

    // Platform treasury / admin — receives 5% fee, can settle and admin-cancel
    const TREASURY: address = @0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60;

    // ===== WagerMatch shared object =====
    public struct WagerMatch has key {
        id: UID,
        player_a: address,
        player_b: Option<address>,
        stake_amount: u64,
        escrow: Balance<SUI>,
        status: u8,
        created_at: u64,
        accepted_at: u64,
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

    /// Create a new wager match. The sender's coins go into escrow.
    public entry fun create_wager(
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
        };

        let match_id = object::id(&wager);

        event::emit(WagerCreated {
            match_id,
            player_a,
            stake_amount,
        });

        transfer::share_object(wager);
    }

    /// Accept a wager match. Player B joins by depositing matching stake into escrow.
    public entry fun accept_wager(
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

    /// Settle the wager. Only the admin (TREASURY) can call this.
    /// Winner receives 95% of total escrow; 5% goes to platform treasury.
    public entry fun settle_wager(
        wager: &mut WagerMatch,
        winner: address,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == TREASURY, EUnauthorized);
        assert!(wager.status == STATUS_ACTIVE, EMatchNotActive);

        // Validate winner is one of the two players
        let player_b_addr = *option::borrow(&wager.player_b);
        assert!(
            winner == wager.player_a || winner == player_b_addr,
            EInvalidWinner,
        );

        let total = balance::value(&wager.escrow);

        // Calculate platform fee (5%)
        let platform_fee = (total * PLATFORM_FEE_BPS) / BPS_BASE;
        let payout = total - platform_fee;

        // Send platform fee to treasury
        let fee_balance = balance::split(&mut wager.escrow, platform_fee);
        let fee_coin = coin::from_balance(fee_balance, ctx);
        transfer::public_transfer(fee_coin, TREASURY);

        // Send remaining to winner
        let winner_balance = balance::withdraw_all(&mut wager.escrow);
        let winner_coin = coin::from_balance(winner_balance, ctx);
        transfer::public_transfer(winner_coin, winner);

        wager.status = STATUS_SETTLED;

        let match_id = object::id(wager);

        event::emit(WagerSettled {
            match_id,
            winner,
            payout,
            platform_fee,
        });
    }

    /// Cancel a wager that hasn't been accepted yet. Only player_a can cancel.
    public entry fun cancel_wager(
        wager: &mut WagerMatch,
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

        let match_id = object::id(wager);

        event::emit(WagerCancelled {
            match_id,
            player_a: wager.player_a,
            refund: refund_amount,
        });
    }

    /// Admin cancel — only TREASURY can call. Works in WAITING or ACTIVE state.
    /// WAITING: refunds player_a fully.
    /// ACTIVE: refunds both players equally (50/50 split).
    public entry fun admin_cancel_wager(
        wager: &mut WagerMatch,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == TREASURY, EUnauthorized);
        assert!(wager.status != STATUS_SETTLED, EMatchAlreadySettled);

        let match_id = object::id(wager);

        if (wager.status == STATUS_WAITING) {
            // Refund player A
            let refund_amount = balance::value(&wager.escrow);
            let refund_balance = balance::withdraw_all(&mut wager.escrow);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, wager.player_a);

            wager.status = STATUS_SETTLED;

            event::emit(WagerCancelled {
                match_id,
                player_a: wager.player_a,
                refund: refund_amount,
            });
        } else {
            // STATUS_ACTIVE — refund both players equally
            let total = balance::value(&wager.escrow);
            let half = total / 2;
            let remainder = total - half;

            let player_b_addr = *option::borrow(&wager.player_b);

            // Player A gets half
            let balance_a = balance::split(&mut wager.escrow, half);
            let coin_a = coin::from_balance(balance_a, ctx);
            transfer::public_transfer(coin_a, wager.player_a);

            // Player B gets the rest (handles odd MIST)
            let balance_b = balance::withdraw_all(&mut wager.escrow);
            let coin_b = coin::from_balance(balance_b, ctx);
            transfer::public_transfer(coin_b, player_b_addr);

            wager.status = STATUS_SETTLED;

            event::emit(WagerRefunded {
                match_id,
                player_a: wager.player_a,
                player_b: player_b_addr,
                refund_each: half,
            });
        };
    }

    /// Cancel an expired wager. Anyone can call this as a safety net.
    /// WAITING + past MATCH_EXPIRY_MS: refunds player_a.
    /// ACTIVE + past SETTLEMENT_TIMEOUT_MS: refunds both players equally.
    public entry fun cancel_expired_wager(
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

            event::emit(WagerCancelled {
                match_id,
                player_a: wager.player_a,
                refund: refund_amount,
            });
        } else {
            // STATUS_ACTIVE — settlement timed out
            assert!(now >= wager.accepted_at + SETTLEMENT_TIMEOUT_MS, ENotExpired);

            let total = balance::value(&wager.escrow);
            let half = total / 2;

            let player_b_addr = *option::borrow(&wager.player_b);

            let balance_a = balance::split(&mut wager.escrow, half);
            let coin_a = coin::from_balance(balance_a, ctx);
            transfer::public_transfer(coin_a, wager.player_a);

            let balance_b = balance::withdraw_all(&mut wager.escrow);
            let coin_b = coin::from_balance(balance_b, ctx);
            transfer::public_transfer(coin_b, player_b_addr);

            wager.status = STATUS_SETTLED;

            event::emit(WagerRefunded {
                match_id,
                player_a: wager.player_a,
                player_b: player_b_addr,
                refund_each: half,
            });
        };
    }

    // ===== Accessor functions =====
    public fun player_a(wager: &WagerMatch): address { wager.player_a }
    public fun player_b(wager: &WagerMatch): Option<address> { wager.player_b }
    public fun stake_amount(wager: &WagerMatch): u64 { wager.stake_amount }
    public fun status(wager: &WagerMatch): u8 { wager.status }
    public fun escrow_value(wager: &WagerMatch): u64 { balance::value(&wager.escrow) }
    public fun created_at(wager: &WagerMatch): u64 { wager.created_at }
    public fun accepted_at(wager: &WagerMatch): u64 { wager.accepted_at }
}
