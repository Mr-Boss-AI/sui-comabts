module sui_combats::arena {
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::table::{Self, Table};
    use sui_combats::character::{Self, Character};

    // ===== Error constants =====
    // v5.1 — codes 0..11 unchanged.
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
    /// v5.1 — Caller already has an open wager (WAITING / ACTIVE /
    /// PENDING_APPROVAL slot). Chain-side primary defence; frontend +
    /// server gates remain as UX.
    const EAlreadyHasOpenWager: u64 = 11;

    // v5.2 — fairness + escape hatch (12..20 per spec §6).

    /// v5.2 — Challenger's character level is outside the ±LEVEL_BRACKET
    /// window from the creator's snapshot level. Raised by
    /// request_accept_wager.
    const ELevelOutOfBracket: u64 = 12;
    /// v5.2 — A function that requires STATUS_PENDING_APPROVAL was called
    /// on a wager in a different status. Raised by approve_challenger,
    /// decline_challenger, withdraw_challenge, cancel_expired_challenge.
    const ENotPendingApproval: u64 = 13;
    /// v5.2 — request_accept_wager called on a wager that already has a
    /// pending_challenger. Only one challenge in flight at a time.
    const EChallengerSlotTaken: u64 = 14;
    /// v5.2 — Wrong wallet called a creator-only PENDING_APPROVAL
    /// transition (approve_challenger / decline_challenger). Distinct
    /// from ENotPlayerA (= 4, WAITING-state cancel_wager) so error-code
    /// triage stays unambiguous for indexers + clients.
    const ENotCreatorForApproval: u64 = 15;
    /// v5.2 — withdraw_challenge was called by a wallet that isn't the
    /// pending_challenger.
    const ENotPendingChallenger: u64 = 16;
    /// v5.2 — cancel_expired_challenge was called before
    /// CHALLENGE_TIMEOUT_MS has elapsed. Mirror of v5.1's ENotExpired
    /// but for the challenge-expiry path; distinct code so client copy
    /// can be specific.
    const EChallengeNotExpired: u64 = 17;
    /// v5.2 — reclaim_stalled_wager was called on a wager whose status
    /// isn't STATUS_ACTIVE. Kept distinct from EMatchNotActive (= 2,
    /// settle_wager's check) so frontend abort-humanizer copy can be
    /// specific to the participant-rights escape-hatch path.
    const ENotActiveForReclaim: u64 = 18;
    /// v5.2 — reclaim_stalled_wager was called before
    /// WAGER_RESOLUTION_TIMEOUT_MS has elapsed since wager.accepted_at.
    /// The only "trust me the fight is over" defence the contract has;
    /// player-facing copy reads e.g. "Wager isn't stalled yet —
    /// settlement window still open."
    const EWagerNotStalled: u64 = 19;
    /// v5.2 — reclaim_stalled_wager was called by a wallet that isn't
    /// one of the wager's two participants (player_a / player_b).
    /// Distinct from ENotPlayerA (= 4); kept separate for client copy +
    /// indexer triage.
    const ENotWagerParticipant: u64 = 20;

    // v5.2 — JUDGMENT-CALL CODES (spec mentions the assertion but does
    // not assign an arena-side abort code; assignments documented in
    // the deploy log § "Spec deviations").

    /// v5.2 — create_wager called when the creator's Character is
    /// currently fight-locked. Defence-in-depth — the equipment module
    /// already covers equip/unequip during a fight; this stops a creator
    /// opening a NEW wager while another fight is mid-flight on the same
    /// character. Spec §7.1 lists the assertion but doesn't name a code;
    /// assigned 21 to keep clean separation from the v5.2 fairness range
    /// 12..20.
    const ECreatorFightLocked: u64 = 21;
    /// v5.2 — create_wager / request_accept_wager called by a wallet
    /// that isn't the owner of the passed Character. Prevents level-
    /// spoofing via a borrowed Character reference. Spec §7.1 / §7.2
    /// refer to this as "ENotOwner" but that's character::ENotOwner
    /// (= 5); arena.move's namespace needs its own non-colliding code.
    const ENotCharacterOwner: u64 = 22;

    // ===== Status constants =====
    const STATUS_WAITING: u8 = 0;
    const STATUS_ACTIVE: u8 = 1;
    const STATUS_SETTLED: u8 = 2;
    /// v5.2 — Challenger has staked; awaiting creator approval. Creator's
    /// stake in `escrow`, challenger's stake in `challenger_escrow`.
    const STATUS_PENDING_APPROVAL: u8 = 3;

    // ===== Platform fee (5%) — unchanged from v5.1 =====
    const PLATFORM_FEE_BPS: u64 = 500;
    const BPS_BASE: u64 = 10_000;

    // ===== Timeouts =====
    const MATCH_EXPIRY_MS: u64 = 600_000;        // 10 min, unchanged
    const SETTLEMENT_TIMEOUT_MS: u64 = 600_000;  // 10 min, unchanged
    /// v5.2 — PENDING_APPROVAL auto-refund. 5 min: short enough that a
    /// creator who abandons the tab doesn't lock the challenger out for
    /// long; long enough for a real creator to see, scout, and click.
    /// Tunable; revisit pre-mainnet.
    const CHALLENGE_TIMEOUT_MS: u64 = 300_000;
    /// v5.2 — Referee-liveness escape hatch. After this long in ACTIVE
    /// with no settlement, either participant can call
    /// reclaim_stalled_wager to refund both stakes (no winner declared).
    /// MUST be clearly longer than any legitimate fight could take —
    /// 30 min is 6× typical fight, 3× SETTLEMENT_TIMEOUT_MS, room for
    /// chain congestion and server-restart recovery. Tunable; revisit
    /// once 99th-percentile settle latency is measured on live testnet.
    const WAGER_RESOLUTION_TIMEOUT_MS: u64 = 1_800_000;

    // ===== Level bracket =====
    /// v5.2 — Inclusive bracket width. ±1 means
    /// |challenger_level - creator_level_snapshot| <= 1. Constant so a
    /// future v5.3 can widen the bracket without a Move rewrite — only
    /// a const bump + republish.
    const LEVEL_BRACKET: u8 = 1;

    // ===== TREASURY — receives platform fee, can settle / admin-cancel.
    // Hardcoded to the v5 publisher wallet. A change requires a fresh publish.
    const TREASURY: address = @0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d;

    // ===== OpenWagerRegistry (v5.1) — unchanged =====
    /// Maps creator address → wager_id. Inserted by create_wager; removed
    /// by any wager-completion path (cancel_wager / settle_wager /
    /// settle_tie / admin_cancel_wager / cancel_expired_wager /
    /// reclaim_stalled_wager).
    public struct OpenWagerRegistry has key {
        id: UID,
        table: Table<address, ID>,
    }

    // ===== WagerMatch (shared) — v5.2 adds 4 fields =====
    public struct WagerMatch has key {
        id: UID,
        player_a: address,
        /// v5.2 — Snapshot of the creator's character level at create
        /// time. The ±1 bracket check in request_accept_wager compares
        /// against this, not the live character level — so a creator who
        /// levels up while WAITING doesn't lock out their original
        /// bracket of possible challengers.
        player_a_level: u8,
        player_b: Option<address>,
        stake_amount: u64,
        escrow: Balance<SUI>,
        /// v5.2 — Challenger's stake while in STATUS_PENDING_APPROVAL.
        /// Empty (Balance::zero) in WAITING / ACTIVE / SETTLED — the
        /// funds either haven't arrived yet (WAITING) or have been
        /// merged into `escrow` on approval.
        challenger_escrow: Balance<SUI>,
        /// v5.2 — Address of the wallet whose request is currently
        /// pending. Set by request_accept_wager; cleared by approve /
        /// decline / withdraw / cancel_expired_challenge /
        /// admin_cancel_wager.
        pending_challenger: Option<address>,
        /// v5.2 — Timestamp the current pending_challenger was
        /// registered. Drives the CHALLENGE_TIMEOUT_MS expiry path.
        pending_at: u64,
        status: u8,
        created_at: u64,
        accepted_at: u64,
        settled_at: u64,
    }

    // ===== Events — v5.1 events kept verbatim, v5.2 adds 5 new =====
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

    /// v5.1 — Mutual-KO outcome. Mirrors WagerRefunded semantically but
    /// is its own type so indexers can break out tie outcomes.
    public struct WagerTied has copy, drop {
        match_id: ID,
        player_a: address,
        player_b: address,
        refund_each: u64,
    }

    /// v5.2 — Emitted by request_accept_wager. Indexers key on this to
    /// transition lobby cards into the PENDING_APPROVAL state.
    public struct ChallengeRequested has copy, drop {
        match_id: ID,
        player_a: address,
        challenger: address,
        challenger_level: u8,
        stake: u64,
        pending_at: u64,
    }

    /// v5.2 — Emitted by decline_challenger.
    public struct ChallengeDeclined has copy, drop {
        match_id: ID,
        player_a: address,
        challenger: address,
        refund: u64,
    }

    /// v5.2 — Emitted by withdraw_challenge.
    public struct ChallengeWithdrawn has copy, drop {
        match_id: ID,
        challenger: address,
        refund: u64,
    }

    /// v5.2 — Emitted by cancel_expired_challenge.
    public struct ChallengeExpired has copy, drop {
        match_id: ID,
        challenger: address,
        refund: u64,
    }

    /// v5.2 — Emitted by reclaim_stalled_wager (referee-liveness escape
    /// hatch). Semantically distinct from WagerRefunded (admin-cancel
    /// split), WagerTied (mutual KO), WagerCancelled (creator-cancel
    /// WAITING). Indexers should treat the four as four separate
    /// terminal categories.
    public struct WagerReclaimed has copy, drop {
        match_id: ID,
        player_a: address,
        player_b: address,
        refund_each: u64,
        /// Address of the participant who called reclaim — soft signal
        /// of who believed the referee had failed.
        reclaimed_by: address,
        /// Cycle time the wager spent in ACTIVE before reclaim fired.
        /// Diagnostic; helps tune WAGER_RESOLUTION_TIMEOUT_MS post-launch.
        elapsed_ms: u64,
    }

    // ===== Init — share OpenWagerRegistry once at publish =====
    fun init(ctx: &mut TxContext) {
        let registry = OpenWagerRegistry {
            id: object::new(ctx),
            table: table::new<address, ID>(ctx),
        };
        transfer::share_object(registry);
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    // ===== Public functions =====

    /// v5.2 — Create a new wager. Sender deposits `stake` into escrow;
    /// status starts WAITING. Snapshots the creator's character level
    /// for the fairness gate; asserts character ownership +
    /// not-fight-locked.
    public fun create_wager(
        stake: Coin<SUI>,
        creator_character: &Character,
        registry: &mut OpenWagerRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let stake_amount = coin::value(&stake);
        assert!(stake_amount > 0, EInvalidStake);

        let player_a = tx_context::sender(ctx);

        // v5.2 — Character must belong to sender (anti-spoofing).
        assert!(character::owner(creator_character) == player_a, ENotCharacterOwner);

        // v5.2 — Defence: cannot open a new wager while fight-locked.
        assert!(!character::is_fight_locked(creator_character, clock), ECreatorFightLocked);

        // v5.1 — One-open-wager-per-wallet chain-side gate.
        assert!(!table::contains(&registry.table, player_a), EAlreadyHasOpenWager);

        let wager = WagerMatch {
            id: object::new(ctx),
            player_a,
            player_a_level: character::level(creator_character),
            player_b: option::none(),
            stake_amount,
            escrow: coin::into_balance(stake),
            challenger_escrow: balance::zero<SUI>(),
            pending_challenger: option::none(),
            pending_at: 0,
            status: STATUS_WAITING,
            created_at: clock::timestamp_ms(clock),
            accepted_at: 0,
            settled_at: 0,
        };

        let match_id = object::id(&wager);

        // Register before share — atomic with the side-effect.
        table::add(&mut registry.table, player_a, match_id);

        event::emit(WagerCreated { match_id, player_a, stake_amount });
        transfer::share_object(wager);
    }

    /// v5.2 — Challenger requests to accept a wager. Stake parks in
    /// challenger_escrow; status moves WAITING → PENDING_APPROVAL. The
    /// creator must explicitly approve_challenger or decline_challenger;
    /// the challenger can withdraw_challenge unilaterally; anyone can
    /// call cancel_expired_challenge after CHALLENGE_TIMEOUT_MS.
    ///
    /// Replaces v5.1's `accept_wager` — the v5.1 entry is REMOVED.
    public fun request_accept_wager(
        wager: &mut WagerMatch,
        stake: Coin<SUI>,
        challenger_character: &Character,
        registry: &OpenWagerRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Assertion order per spec §7.2 — each abort gives a more
        // specific error than the next.
        assert!(wager.status == STATUS_WAITING, EMatchNotWaiting);
        assert!(option::is_none(&wager.pending_challenger), EChallengerSlotTaken);

        let sender = tx_context::sender(ctx);

        // v5.1 — challenger must not themselves be a creator.
        assert!(!table::contains(&registry.table, sender), EAlreadyHasOpenWager);

        assert!(sender != wager.player_a, ECannotJoinOwnMatch);

        // v5.2 — character ownership (anti-spoofing).
        assert!(character::owner(challenger_character) == sender, ENotCharacterOwner);

        // v5.2 — ±LEVEL_BRACKET window. u8 subtraction underflows in
        // Move, so compute as a two-side compare.
        let challenger_level = character::level(challenger_character);
        let creator_level = wager.player_a_level;
        let in_bracket = if (challenger_level >= creator_level) {
            challenger_level - creator_level <= LEVEL_BRACKET
        } else {
            creator_level - challenger_level <= LEVEL_BRACKET
        };
        assert!(in_bracket, ELevelOutOfBracket);

        // Stake match (preserved from v5.1's accept_wager).
        let stake_value = coin::value(&stake);
        assert!(stake_value == wager.stake_amount, EStakeMismatch);

        // Mutations.
        balance::join(&mut wager.challenger_escrow, coin::into_balance(stake));
        wager.pending_challenger = option::some(sender);
        wager.pending_at = clock::timestamp_ms(clock);
        wager.status = STATUS_PENDING_APPROVAL;

        let match_id = object::id(wager);
        event::emit(ChallengeRequested {
            match_id,
            player_a: wager.player_a,
            challenger: sender,
            challenger_level,
            stake: stake_value,
            pending_at: wager.pending_at,
        });
    }

    /// v5.2 — Creator approves the pending challenger. Merges
    /// challenger_escrow into escrow; status PENDING_APPROVAL → ACTIVE.
    /// Reuses the v5.1 WagerAccepted event shape so v5.1 indexers keep
    /// working.
    public fun approve_challenger(
        wager: &mut WagerMatch,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(wager.status == STATUS_PENDING_APPROVAL, ENotPendingApproval);
        assert!(tx_context::sender(ctx) == wager.player_a, ENotCreatorForApproval);
        assert!(option::is_some(&wager.pending_challenger), ENoOpponent);

        let challenger = *option::borrow(&wager.pending_challenger);

        // Merge challenger's stake into the main escrow.
        let challenger_balance = balance::withdraw_all(&mut wager.challenger_escrow);
        balance::join(&mut wager.escrow, challenger_balance);

        wager.player_b = option::some(challenger);
        wager.pending_challenger = option::none();
        wager.pending_at = 0;
        wager.status = STATUS_ACTIVE;
        wager.accepted_at = clock::timestamp_ms(clock);

        let match_id = object::id(wager);
        let total_stake = balance::value(&wager.escrow);

        event::emit(WagerAccepted {
            match_id,
            player_a: wager.player_a,
            player_b: challenger,
            total_stake,
        });
    }

    /// v5.2 — Creator declines the pending challenger. Refunds the
    /// challenger from challenger_escrow; status PENDING_APPROVAL →
    /// WAITING.
    public fun decline_challenger(
        wager: &mut WagerMatch,
        ctx: &mut TxContext,
    ) {
        assert!(wager.status == STATUS_PENDING_APPROVAL, ENotPendingApproval);
        assert!(tx_context::sender(ctx) == wager.player_a, ENotCreatorForApproval);
        assert!(option::is_some(&wager.pending_challenger), ENoOpponent);

        let challenger = *option::borrow(&wager.pending_challenger);
        let refund_amount = balance::value(&wager.challenger_escrow);

        let refund_balance = balance::withdraw_all(&mut wager.challenger_escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, challenger);

        wager.pending_challenger = option::none();
        wager.pending_at = 0;
        wager.status = STATUS_WAITING;

        let match_id = object::id(wager);
        event::emit(ChallengeDeclined {
            match_id,
            player_a: wager.player_a,
            challenger,
            refund: refund_amount,
        });
    }

    /// v5.2 — Challenger withdraws their own pending request. Strictly
    /// stronger than lock-on-approval: the challenger never has to wait
    /// for the creator to act. Refunds the challenger; status
    /// PENDING_APPROVAL → WAITING.
    public fun withdraw_challenge(
        wager: &mut WagerMatch,
        ctx: &mut TxContext,
    ) {
        assert!(wager.status == STATUS_PENDING_APPROVAL, ENotPendingApproval);
        assert!(option::is_some(&wager.pending_challenger), ENoOpponent);
        let challenger = *option::borrow(&wager.pending_challenger);
        assert!(tx_context::sender(ctx) == challenger, ENotPendingChallenger);

        let refund_amount = balance::value(&wager.challenger_escrow);

        let refund_balance = balance::withdraw_all(&mut wager.challenger_escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, challenger);

        wager.pending_challenger = option::none();
        wager.pending_at = 0;
        wager.status = STATUS_WAITING;

        let match_id = object::id(wager);
        event::emit(ChallengeWithdrawn {
            match_id,
            challenger,
            refund: refund_amount,
        });
    }

    /// v5.2 — Anyone can clear an expired pending challenge after
    /// CHALLENGE_TIMEOUT_MS. Refunds the challenger; status
    /// PENDING_APPROVAL → WAITING. Same anti-strand role as v5.1's
    /// cancel_expired_wager (WAITING arm) but for the challenge state.
    public fun cancel_expired_challenge(
        wager: &mut WagerMatch,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(wager.status == STATUS_PENDING_APPROVAL, ENotPendingApproval);
        let now = clock::timestamp_ms(clock);
        assert!(now >= wager.pending_at + CHALLENGE_TIMEOUT_MS, EChallengeNotExpired);
        assert!(option::is_some(&wager.pending_challenger), ENoOpponent);

        let challenger = *option::borrow(&wager.pending_challenger);
        let refund_amount = balance::value(&wager.challenger_escrow);

        let refund_balance = balance::withdraw_all(&mut wager.challenger_escrow);
        let refund_coin = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund_coin, challenger);

        wager.pending_challenger = option::none();
        wager.pending_at = 0;
        wager.status = STATUS_WAITING;

        let match_id = object::id(wager);
        event::emit(ChallengeExpired {
            match_id,
            challenger,
            refund: refund_amount,
        });
    }

    /// Settle a finished wager. TREASURY-only. `winner` MUST be one of
    /// the two participants. 95% to winner / 5% to TREASURY. Unchanged
    /// from v5.1.
    public fun settle_wager(
        wager: &mut WagerMatch,
        winner: address,
        registry: &mut OpenWagerRegistry,
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

        if (table::contains(&registry.table, wager.player_a)) {
            let _ = table::remove(&mut registry.table, wager.player_a);
        };

        let match_id = object::id(wager);

        event::emit(WagerSettled {
            match_id,
            winner,
            payout,
            platform_fee,
        });
    }

    /// v5.1 — TREASURY-only mutual-KO refund: 100% to each participant,
    /// NO platform fee. Emits WagerTied. Unchanged in v5.2.
    public fun settle_tie(
        wager: &mut WagerMatch,
        registry: &mut OpenWagerRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == TREASURY, EUnauthorized);
        assert!(wager.status == STATUS_ACTIVE, EMatchNotActive);
        assert!(option::is_some(&wager.player_b), ENoOpponent);

        let player_b_addr = *option::borrow(&wager.player_b);
        let stake = wager.stake_amount;

        let balance_a = balance::split(&mut wager.escrow, stake);
        let coin_a = coin::from_balance(balance_a, ctx);
        transfer::public_transfer(coin_a, wager.player_a);

        let balance_b = balance::withdraw_all(&mut wager.escrow);
        let coin_b = coin::from_balance(balance_b, ctx);
        transfer::public_transfer(coin_b, player_b_addr);

        wager.status = STATUS_SETTLED;
        wager.settled_at = clock::timestamp_ms(clock);

        if (table::contains(&registry.table, wager.player_a)) {
            let _ = table::remove(&mut registry.table, wager.player_a);
        };

        let match_id = object::id(wager);

        event::emit(WagerTied {
            match_id,
            player_a: wager.player_a,
            player_b: player_b_addr,
            refund_each: stake,
        });
    }

    /// Player A cancels their own unaccepted wager. WAITING-only.
    /// PENDING_APPROVAL is NOT cancellable unilaterally — the creator
    /// must decline_challenger first to return to WAITING (two-tx flow,
    /// but no funds risk to the challenger). Unchanged from v5.1.
    public fun cancel_wager(
        wager: &mut WagerMatch,
        registry: &mut OpenWagerRegistry,
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

        if (table::contains(&registry.table, wager.player_a)) {
            let _ = table::remove(&mut registry.table, wager.player_a);
        };

        let match_id = object::id(wager);

        event::emit(WagerCancelled {
            match_id,
            player_a: wager.player_a,
            refund: refund_amount,
        });
    }

    /// TREASURY can cancel any non-settled wager.
    /// WAITING: refund creator. ACTIVE: 50/50 split.
    /// v5.2 — PENDING_APPROVAL: refund creator from `escrow`, refund
    /// challenger from `challenger_escrow`. Each side gets back exactly
    /// their own stake (escrows weren't merged yet).
    public fun admin_cancel_wager(
        wager: &mut WagerMatch,
        registry: &mut OpenWagerRegistry,
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
        } else if (wager.status == STATUS_ACTIVE) {
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
        } else {
            // v5.2 — STATUS_PENDING_APPROVAL: each side gets back their
            // own stake; neither escrow was merged yet.
            assert!(option::is_some(&wager.pending_challenger), ENoOpponent);
            let challenger = *option::borrow(&wager.pending_challenger);

            let creator_refund = balance::value(&wager.escrow);
            let creator_balance = balance::withdraw_all(&mut wager.escrow);
            let creator_coin = coin::from_balance(creator_balance, ctx);
            transfer::public_transfer(creator_coin, wager.player_a);

            let challenger_balance = balance::withdraw_all(&mut wager.challenger_escrow);
            let challenger_coin = coin::from_balance(challenger_balance, ctx);
            transfer::public_transfer(challenger_coin, challenger);

            wager.pending_challenger = option::none();
            wager.pending_at = 0;
            wager.status = STATUS_SETTLED;
            wager.settled_at = now;

            event::emit(WagerRefunded {
                match_id,
                player_a: wager.player_a,
                player_b: challenger,
                refund_each: creator_refund,
            });
        };

        if (table::contains(&registry.table, wager.player_a)) {
            let _ = table::remove(&mut registry.table, wager.player_a);
        };
    }

    /// Anyone can refund an expired wager.
    /// WAITING + past MATCH_EXPIRY_MS: refund player_a.
    /// ACTIVE + past SETTLEMENT_TIMEOUT_MS: 50/50 split.
    /// PENDING_APPROVAL is handled by the dedicated
    /// cancel_expired_challenge (different timeout, different event);
    /// callers reaching this path on a PENDING_APPROVAL wager abort at
    /// the ACTIVE-branch's ENoOpponent (player_b is None until approve).
    public fun cancel_expired_wager(
        wager: &mut WagerMatch,
        registry: &mut OpenWagerRegistry,
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
            // STATUS_ACTIVE (or PENDING_APPROVAL — see docstring).
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
        };

        if (table::contains(&registry.table, wager.player_a)) {
            let _ = table::remove(&mut registry.table, wager.player_a);
        };
    }

    /// v5.2 — Referee-liveness escape hatch. Either participant in an
    /// ACTIVE wager can call this after WAGER_RESOLUTION_TIMEOUT_MS to
    /// refund both stakes (no winner declared). Closes the
    /// centralized-referee single-point-of-failure risk: even if
    /// TREASURY is down, compromised, or stalled, players have an
    /// on-chain right to reclaim their escrow. The clock gate
    /// (WAGER_RESOLUTION_TIMEOUT_MS = 30 min) prevents mid-fight abuse
    /// where a losing player would escape a loss.
    public fun reclaim_stalled_wager(
        wager: &mut WagerMatch,
        registry: &mut OpenWagerRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Assertion order per spec §7.11 — each abort gives a more
        // specific error than the next.
        assert!(wager.status == STATUS_ACTIVE, ENotActiveForReclaim);
        assert!(option::is_some(&wager.player_b), ENoOpponent);

        let now = clock::timestamp_ms(clock);
        assert!(now >= wager.accepted_at + WAGER_RESOLUTION_TIMEOUT_MS, EWagerNotStalled);

        let sender = tx_context::sender(ctx);
        let player_b_addr = *option::borrow(&wager.player_b);
        assert!(
            sender == wager.player_a || sender == player_b_addr,
            ENotWagerParticipant,
        );

        let stake = wager.stake_amount;
        let elapsed_ms = now - wager.accepted_at;

        // Refund each side their original stake. escrow holds 2 × stake.
        // Same shape as settle_tie: no platform fee, no winner.
        let balance_a = balance::split(&mut wager.escrow, stake);
        let coin_a = coin::from_balance(balance_a, ctx);
        transfer::public_transfer(coin_a, wager.player_a);

        let balance_b = balance::withdraw_all(&mut wager.escrow);
        let coin_b = coin::from_balance(balance_b, ctx);
        transfer::public_transfer(coin_b, player_b_addr);

        wager.status = STATUS_SETTLED;
        wager.settled_at = now;

        if (table::contains(&registry.table, wager.player_a)) {
            let _ = table::remove(&mut registry.table, wager.player_a);
        };

        let match_id = object::id(wager);
        event::emit(WagerReclaimed {
            match_id,
            player_a: wager.player_a,
            player_b: player_b_addr,
            refund_each: stake,
            reclaimed_by: sender,
            elapsed_ms,
        });
    }

    // ===== Read-only accessors =====
    public fun player_a(wager: &WagerMatch): address { wager.player_a }
    /// v5.2 — Creator's snapshot level at create_wager time.
    public fun player_a_level(wager: &WagerMatch): u8 { wager.player_a_level }
    public fun player_b(wager: &WagerMatch): Option<address> { wager.player_b }
    public fun stake_amount(wager: &WagerMatch): u64 { wager.stake_amount }
    public fun status(wager: &WagerMatch): u8 { wager.status }
    public fun escrow_value(wager: &WagerMatch): u64 { balance::value(&wager.escrow) }
    /// v5.2 — Challenger's stake while in PENDING_APPROVAL; 0 otherwise.
    public fun challenger_escrow_value(wager: &WagerMatch): u64 {
        balance::value(&wager.challenger_escrow)
    }
    /// v5.2 — Currently-pending challenger (Some only in PENDING_APPROVAL).
    public fun pending_challenger(wager: &WagerMatch): Option<address> {
        wager.pending_challenger
    }
    /// v5.2 — Timestamp pending_challenger was registered.
    public fun pending_at(wager: &WagerMatch): u64 { wager.pending_at }
    public fun created_at(wager: &WagerMatch): u64 { wager.created_at }
    public fun accepted_at(wager: &WagerMatch): u64 { wager.accepted_at }
    public fun settled_at(wager: &WagerMatch): u64 { wager.settled_at }
    public fun treasury_address(): address { TREASURY }

    /// v5.1 — Registry accessors for tests + read-only clients.
    public fun registry_has(registry: &OpenWagerRegistry, who: address): bool {
        table::contains(&registry.table, who)
    }

    public fun registry_get(registry: &OpenWagerRegistry, who: address): ID {
        *table::borrow(&registry.table, who)
    }

    // ===== Test-only constant accessors =====
    #[test_only]
    public fun status_pending_approval(): u8 { STATUS_PENDING_APPROVAL }
    #[test_only]
    public fun challenge_timeout_ms(): u64 { CHALLENGE_TIMEOUT_MS }
    #[test_only]
    public fun wager_resolution_timeout_ms(): u64 { WAGER_RESOLUTION_TIMEOUT_MS }
    #[test_only]
    public fun level_bracket(): u8 { LEVEL_BRACKET }

    /// v5.2 — Test-only state mutator. EChallengerSlotTaken (= 14) is
    /// belt-and-suspenders: with the public-API state machine intact,
    /// request_accept_wager's status==WAITING assertion fires before the
    /// pending_challenger==None assertion. This helper lets the test
    /// suite force the unreachable-by-construction state (status=WAITING
    /// AND pending_challenger=Some) to verify code 14 is still wired
    /// correctly as defence-in-depth. Not exposed outside test builds.
    #[test_only]
    public fun force_status_for_testing(wager: &mut WagerMatch, status: u8) {
        wager.status = status;
    }
}
