/// v5.3 — Guild wars (combats.ru-style clan battles with SUI stakes).
///
/// Flow:
///   1. declare_war   — Leader/Officer of guild A picks guild B, team size
///                      (2..10 per side), per-fighter stake (0 = honour war),
///                      level rule and start delay.
///   2. accept_war    — Leader/Officer of guild B accepts before start time.
///   3. join_war      — members of either guild sign up, paying the stake.
///      leave_war     — withdraw before start (refund).
///   4. start_war     — TREASURY, at/after start time. "Scales": both sides
///                      trimmed to the same size (last signers refunded);
///                      < 2 per side → cancelled + refunded. Guilds war-locked.
///   5. settle_war    — TREASURY after the server-side battle. 5% fee, 95%
///                      split equally among all winning-side fighters; draw =
///                      full refund. Guild W/L/D + rating updated.
///   Escape hatches (permissionless, no trust in the server):
///      expire_war          — never accepted / never started → refunds.
///      reclaim_stalled_war — ACTIVE for WAR_RESOLUTION_TIMEOUT_MS → refunds.
#[allow(lint(self_transfer))]
module sui_combats::guild_war {
    use sui_combats::version;
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::table::{Self, Table};
    use sui_combats::character::{Self, Character};
    use sui_combats::guild::{Self, Guild};
    use sui_combats::arena;

    // ===== Errors =====
    const ENotOfficer: u64 = 0;
    const ESameGuild: u64 = 1;
    const EBadTeamSize: u64 = 2;
    const EBadStartDelay: u64 = 3;
    const EBadLevelRule: u64 = 4;
    const ENotCharacterOwner: u64 = 5;
    const EWrongStatus: u64 = 6;
    const EWrongGuild: u64 = 7;
    const ESignupClosed: u64 = 8;
    const ENotMember: u64 = 9;
    const ELevelOutOfRange: u64 = 10;
    const EFightLocked: u64 = 11;
    const EAlreadyInWar: u64 = 12;
    const ESideFull: u64 = 13;
    const EWrongStake: u64 = 14;
    const ENotInWar: u64 = 15;
    const EUnauthorized: u64 = 16;
    const ETooEarly: u64 = 17;
    const EBadWinner: u64 = 18;
    const ENotExpired: u64 = 19;
    const ENotParticipant: u64 = 20;

    // ===== Status =====
    const STATUS_DECLARED: u8 = 0;
    const STATUS_ACCEPTED: u8 = 1;
    const STATUS_ACTIVE: u8 = 2;
    const STATUS_SETTLED: u8 = 3;
    const STATUS_CANCELLED: u8 = 4;

    // ===== Sides / outcomes =====
    const SIDE_A: u8 = 1;
    const SIDE_B: u8 = 2;
    const DRAW: u8 = 3;

    // ===== Level rules =====
    const RULE_ANY: u8 = 0;
    const RULE_SAME: u8 = 1;
    const RULE_PLUS_MINUS_ONE: u8 = 2;

    // ===== Limits / timeouts =====
    const MIN_TEAM: u64 = 2;
    const MAX_TEAM: u64 = 10;
    const MIN_START_DELAY_MS: u64 = 300_000;       // 5 min
    const MAX_START_DELAY_MS: u64 = 1_800_000;     // 30 min
    /// After start_at, an accepted war that TREASURY never started can be
    /// expired by anyone once this grace has passed.
    const START_GRACE_MS: u64 = 600_000;           // 10 min
    /// ACTIVE longer than this → any participant may reclaim (refund all).
    const WAR_RESOLUTION_TIMEOUT_MS: u64 = 3_600_000; // 60 min
    /// Guild membership/treasury frozen this long from start (≤ guild cap).
    const WAR_LOCK_MS: u64 = 5_400_000;            // 90 min
    const PLATFORM_FEE_BPS: u64 = 500;
    const BPS_BASE: u64 = 10_000;
    const RATING_BASE_CHANGE: u64 = 16;
    const RATING_MIN: u16 = 100;

    // ===== Objects =====

    /// Shared, created at publish. One open war per fighter.
    public struct WarRegistry has key {
        id: UID,
        version: u64,
        fighters: Table<address, ID>,
    }

    public struct GuildWar has key {
        id: UID,
        version: u64,
        guild_a: ID,
        guild_b: ID,
        declared_by: address,
        team_size: u64,
        stake: u64,
        level_rule: u8,
        level_min: u8,
        level_max: u8,
        status: u8,
        declared_at: u64,
        start_at: u64,
        started_at: u64,
        settled_at: u64,
        side_a: vector<address>,
        side_b: vector<address>,
        escrow: Balance<SUI>,
        /// 0 until settled; SIDE_A / SIDE_B / DRAW after.
        winner: u8,
    }

    // ===== Events =====
    public struct WarDeclared has copy, drop { war_id: ID, guild_a: ID, guild_b: ID, team_size: u64, stake: u64, level_min: u8, level_max: u8, start_at: u64 }
    public struct WarAccepted has copy, drop { war_id: ID, guild_b: ID, by: address }
    public struct WarJoined has copy, drop { war_id: ID, fighter: address, side: u8 }
    public struct WarLeft has copy, drop { war_id: ID, fighter: address, refund: u64 }
    public struct WarStarted has copy, drop { war_id: ID, side_a: vector<address>, side_b: vector<address> }
    public struct WarCancelled has copy, drop { war_id: ID, reason: u8 }  // 0 expired, 1 too few fighters, 2 stalled
    public struct WarSettled has copy, drop { war_id: ID, winner: u8, payout_each: u64, platform_fee: u64 }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(WarRegistry { id: object::new(ctx), version: version::current(), fighters: table::new(ctx) });
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }

    // ===== 1. Declare =====

    public fun declare_war(
        guild_a: &mut Guild,
        guild_b: &Guild,
        declarer_character: &Character,
        team_size: u64,
        stake: u64,
        level_rule: u8,
        start_delay_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        guild::check_version(guild_a);
        guild::check_version(guild_b);
        character::check_version(declarer_character);
        let sender = ctx.sender();
        assert!(guild::is_member(guild_a, sender) && guild::role_of(guild_a, sender) >= guild::role_officer(), ENotOfficer);
        assert!(object::id(guild_a) != object::id(guild_b), ESameGuild);
        assert!(team_size >= MIN_TEAM && team_size <= MAX_TEAM, EBadTeamSize);
        assert!(start_delay_ms >= MIN_START_DELAY_MS && start_delay_ms <= MAX_START_DELAY_MS, EBadStartDelay);
        assert!(level_rule <= RULE_PLUS_MINUS_ONE, EBadLevelRule);
        assert!(character::owner(declarer_character) == sender, ENotCharacterOwner);

        let lvl = character::level(declarer_character);
        let (level_min, level_max) = if (level_rule == RULE_ANY) { (1u8, 20u8) }
            else if (level_rule == RULE_SAME) { (lvl, lvl) }
            else { (if (lvl > 1) lvl - 1 else 1, if (lvl < 20) lvl + 1 else 20) };

        let now = clock::timestamp_ms(clock);
        let war = GuildWar {
            id: object::new(ctx),
            version: version::current(),
            guild_a: object::id(guild_a),
            guild_b: object::id(guild_b),
            declared_by: sender,
            team_size, stake, level_rule, level_min, level_max,
            status: STATUS_DECLARED,
            declared_at: now,
            start_at: now + start_delay_ms,
            started_at: 0,
            settled_at: 0,
            side_a: vector[],
            side_b: vector[],
            escrow: balance::zero(),
            winner: 0,
        };
        let war_id = object::id(&war);
        guild::set_open_war(guild_a, war_id);
        event::emit(WarDeclared {
            war_id, guild_a: war.guild_a, guild_b: war.guild_b, team_size, stake, level_min, level_max, start_at: war.start_at,
        });
        transfer::share_object(war);
    }

    // ===== 2. Accept =====

    public fun accept_war(war: &mut GuildWar, guild_b: &mut Guild, clock: &Clock, ctx: &mut TxContext) {
        version::check(war.version);
        guild::check_version(guild_b);
        let sender = ctx.sender();
        assert!(war.status == STATUS_DECLARED, EWrongStatus);
        assert!(object::id(guild_b) == war.guild_b, EWrongGuild);
        assert!(clock::timestamp_ms(clock) < war.start_at, ESignupClosed);
        assert!(guild::is_member(guild_b, sender) && guild::role_of(guild_b, sender) >= guild::role_officer(), ENotOfficer);
        guild::set_open_war(guild_b, object::id(war));
        war.status = STATUS_ACCEPTED;
        event::emit(WarAccepted { war_id: object::id(war), guild_b: war.guild_b, by: sender });
    }

    // ===== 3. Sign up / leave =====

    public fun join_war(
        war: &mut GuildWar,
        registry: &mut WarRegistry,
        guild: &Guild,
        character: &Character,
        stake: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        version::check(war.version);
        version::check(registry.version);
        guild::check_version(guild);
        character::check_version(character);
        let sender = ctx.sender();
        assert!(war.status == STATUS_DECLARED || war.status == STATUS_ACCEPTED, EWrongStatus);
        assert!(clock::timestamp_ms(clock) < war.start_at, ESignupClosed);
        let gid = object::id(guild);
        assert!(gid == war.guild_a || gid == war.guild_b, EWrongGuild);
        assert!(guild::is_member(guild, sender), ENotMember);
        assert!(character::owner(character) == sender, ENotCharacterOwner);
        let lvl = character::level(character);
        assert!(lvl >= war.level_min && lvl <= war.level_max, ELevelOutOfRange);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(!table::contains(&registry.fighters, sender), EAlreadyInWar);
        assert!(coin::value(&stake) == war.stake, EWrongStake);

        let side = if (gid == war.guild_a) SIDE_A else SIDE_B;
        let list = if (side == SIDE_A) &mut war.side_a else &mut war.side_b;
        assert!(list.length() < war.team_size, ESideFull);
        list.push_back(sender);

        balance::join(&mut war.escrow, coin::into_balance(stake));
        table::add(&mut registry.fighters, sender, object::id(war));
        event::emit(WarJoined { war_id: object::id(war), fighter: sender, side });
    }

    public fun leave_war(war: &mut GuildWar, registry: &mut WarRegistry, clock: &Clock, ctx: &mut TxContext) {
        version::check(war.version);
        version::check(registry.version);
        let sender = ctx.sender();
        assert!(war.status == STATUS_DECLARED || war.status == STATUS_ACCEPTED, EWrongStatus);
        assert!(clock::timestamp_ms(clock) < war.start_at, ESignupClosed);
        let removed = remove_from(&mut war.side_a, sender) || remove_from(&mut war.side_b, sender);
        assert!(removed, ENotInWar);
        table::remove(&mut registry.fighters, sender);
        pay(&mut war.escrow, war.stake, sender, ctx);
        event::emit(WarLeft { war_id: object::id(war), fighter: sender, refund: war.stake });
    }

    // ===== 4. Start (TREASURY) =====

    public fun start_war(
        war: &mut GuildWar,
        registry: &mut WarRegistry,
        guild_a: &mut Guild,
        guild_b: &mut Guild,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        version::check(war.version);
        version::check(registry.version);
        guild::check_version(guild_a);
        guild::check_version(guild_b);
        assert!(ctx.sender() == arena::treasury_address(), EUnauthorized);
        assert!(war.status == STATUS_ACCEPTED, EWrongStatus);
        assert!(object::id(guild_a) == war.guild_a && object::id(guild_b) == war.guild_b, EWrongGuild);
        let now = clock::timestamp_ms(clock);
        assert!(now >= war.start_at, ETooEarly);

        // Drop anyone who left their guild since signing up (refund).
        drop_non_members(war, registry, guild_a, SIDE_A, ctx);
        drop_non_members(war, registry, guild_b, SIDE_B, ctx);

        let a = war.side_a.length();
        let b = war.side_b.length();
        let n = if (a < b) a else b;
        if (n < MIN_TEAM) {
            refund_all(war, registry, ctx);
            finish(war, guild_a, guild_b, STATUS_CANCELLED, now, clock);
            event::emit(WarCancelled { war_id: object::id(war), reason: 1 });
            return
        };
        // The scales: trim both sides to n (last signers refunded).
        trim(war, registry, SIDE_A, n, ctx);
        trim(war, registry, SIDE_B, n, ctx);

        guild::set_war_lock(guild_a, now + WAR_LOCK_MS, clock);
        guild::set_war_lock(guild_b, now + WAR_LOCK_MS, clock);
        war.status = STATUS_ACTIVE;
        war.started_at = now;
        event::emit(WarStarted { war_id: object::id(war), side_a: war.side_a, side_b: war.side_b });
    }

    // ===== 5. Settle (TREASURY) =====

    public fun settle_war(
        war: &mut GuildWar,
        registry: &mut WarRegistry,
        guild_a: &mut Guild,
        guild_b: &mut Guild,
        winner: u8,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        version::check(war.version);
        version::check(registry.version);
        guild::check_version(guild_a);
        guild::check_version(guild_b);
        assert!(ctx.sender() == arena::treasury_address(), EUnauthorized);
        assert!(war.status == STATUS_ACTIVE, EWrongStatus);
        assert!(object::id(guild_a) == war.guild_a && object::id(guild_b) == war.guild_b, EWrongGuild);
        assert!(winner == SIDE_A || winner == SIDE_B || winner == DRAW, EBadWinner);
        let now = clock::timestamp_ms(clock);

        let mut payout_each = war.stake;
        let mut fee = 0;
        if (winner == DRAW) {
            refund_all(war, registry, ctx);
            let (ra, rb) = (guild::rating(guild_a), guild::rating(guild_b));
            guild::record_war_result(guild_a, 2, ra);
            guild::record_war_result(guild_b, 2, rb);
        } else {
            let total = balance::value(&war.escrow);
            fee = total * PLATFORM_FEE_BPS / BPS_BASE;
            let winners = if (winner == SIDE_A) war.side_a else war.side_b;
            let n = winners.length();
            payout_each = (total - fee) / n;
            let mut i = 0;
            while (i < n) { pay(&mut war.escrow, payout_each, winners[i], ctx); i = i + 1; };
            // fee + rounding dust → TREASURY (never stuck)
            let rest = balance::value(&war.escrow);
            pay(&mut war.escrow, rest, arena::treasury_address(), ctx);
            clear_fighters(war, registry);

            let (ra, rb) = (guild::rating(guild_a), guild::rating(guild_b));
            let (new_a, new_b) = if (winner == SIDE_A) { let (w, l) = elo(ra, rb); (w, l) } else { let (w, l) = elo(rb, ra); (l, w) };
            guild::record_war_result(guild_a, if (winner == SIDE_A) 1 else 0, new_a);
            guild::record_war_result(guild_b, if (winner == SIDE_B) 1 else 0, new_b);
        };
        war.winner = winner;
        finish(war, guild_a, guild_b, STATUS_SETTLED, now, clock);
        event::emit(WarSettled { war_id: object::id(war), winner, payout_each, platform_fee: fee });
    }

    // ===== Escape hatches (permissionless) =====

    /// Never accepted by start time, or accepted but not started within
    /// START_GRACE_MS of start time → full refunds.
    public fun expire_war(
        war: &mut GuildWar,
        registry: &mut WarRegistry,
        guild_a: &mut Guild,
        guild_b: &mut Guild,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        version::check(war.version);
        version::check(registry.version);
        guild::check_version(guild_a);
        guild::check_version(guild_b);
        assert!(object::id(guild_a) == war.guild_a && object::id(guild_b) == war.guild_b, EWrongGuild);
        let now = clock::timestamp_ms(clock);
        let expired = (war.status == STATUS_DECLARED && now >= war.start_at)
            || (war.status == STATUS_ACCEPTED && now >= war.start_at + START_GRACE_MS);
        assert!(expired, ENotExpired);
        refund_all(war, registry, ctx);
        finish(war, guild_a, guild_b, STATUS_CANCELLED, now, clock);
        event::emit(WarCancelled { war_id: object::id(war), reason: 0 });
    }

    /// ACTIVE for WAR_RESOLUTION_TIMEOUT_MS without settlement → any
    /// participant refunds everyone (no winner).
    public fun reclaim_stalled_war(
        war: &mut GuildWar,
        registry: &mut WarRegistry,
        guild_a: &mut Guild,
        guild_b: &mut Guild,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        version::check(war.version);
        version::check(registry.version);
        guild::check_version(guild_a);
        guild::check_version(guild_b);
        assert!(war.status == STATUS_ACTIVE, EWrongStatus);
        assert!(object::id(guild_a) == war.guild_a && object::id(guild_b) == war.guild_b, EWrongGuild);
        let sender = ctx.sender();
        assert!(war.side_a.contains(&sender) || war.side_b.contains(&sender), ENotParticipant);
        let now = clock::timestamp_ms(clock);
        assert!(now >= war.started_at + WAR_RESOLUTION_TIMEOUT_MS, ETooEarly);
        refund_all(war, registry, ctx);
        finish(war, guild_a, guild_b, STATUS_CANCELLED, now, clock);
        event::emit(WarCancelled { war_id: object::id(war), reason: 2 });
    }

    // ===== Internal =====

    fun pay(escrow: &mut Balance<SUI>, amount: u64, to: address, ctx: &mut TxContext) {
        if (amount == 0) return;
        transfer::public_transfer(coin::from_balance(balance::split(escrow, amount), ctx), to);
    }

    fun remove_from(list: &mut vector<address>, who: address): bool {
        let (found, i) = list.index_of(&who);
        if (found) { list.remove(i); };
        found
    }

    fun refund_all(war: &mut GuildWar, registry: &mut WarRegistry, ctx: &mut TxContext) {
        let everyone = {
            let mut v = war.side_a;
            v.append(war.side_b);
            v
        };
        let mut i = 0;
        while (i < everyone.length()) {
            pay(&mut war.escrow, war.stake, everyone[i], ctx);
            i = i + 1;
        };
        clear_fighters(war, registry);
    }

    fun clear_fighters(war: &GuildWar, registry: &mut WarRegistry) {
        let mut i = 0;
        while (i < war.side_a.length()) { let a = war.side_a[i]; if (table::contains(&registry.fighters, a)) { table::remove(&mut registry.fighters, a); }; i = i + 1; };
        let mut j = 0;
        while (j < war.side_b.length()) { let b = war.side_b[j]; if (table::contains(&registry.fighters, b)) { table::remove(&mut registry.fighters, b); }; j = j + 1; };
    }

    fun trim(war: &mut GuildWar, registry: &mut WarRegistry, side: u8, n: u64, ctx: &mut TxContext) {
        loop {
            let len = if (side == SIDE_A) war.side_a.length() else war.side_b.length();
            if (len <= n) break;
            let who = if (side == SIDE_A) war.side_a.pop_back() else war.side_b.pop_back();
            table::remove(&mut registry.fighters, who);
            pay(&mut war.escrow, war.stake, who, ctx);
            event::emit(WarLeft { war_id: object::id(war), fighter: who, refund: war.stake });
        };
    }

    fun drop_non_members(war: &mut GuildWar, registry: &mut WarRegistry, g: &Guild, side: u8, ctx: &mut TxContext) {
        let mut i = 0;
        loop {
            let len = if (side == SIDE_A) war.side_a.length() else war.side_b.length();
            if (i >= len) break;
            let who = if (side == SIDE_A) war.side_a[i] else war.side_b[i];
            if (guild::is_member(g, who)) { i = i + 1; continue };
            if (side == SIDE_A) { war.side_a.remove(i); } else { war.side_b.remove(i); };
            table::remove(&mut registry.fighters, who);
            pay(&mut war.escrow, war.stake, who, ctx);
            event::emit(WarLeft { war_id: object::id(war), fighter: who, refund: war.stake });
        };
    }

    fun finish(war: &mut GuildWar, guild_a: &mut Guild, guild_b: &mut Guild, status: u8, now: u64, clock: &Clock) {
        let id = object::id(war);
        guild::clear_open_war(guild_a, id);
        guild::clear_open_war(guild_b, id);
        if (war.status == STATUS_ACTIVE) {
            guild::set_war_lock(guild_a, 0, clock);
            guild::set_war_lock(guild_b, 0, clock);
        };
        war.status = status;
        war.settled_at = now;
    }

    /// Simplified Elo: winner gains 16 ± rating gap / 25 (clamped 4..28).
    fun elo(winner: u16, loser: u16): (u16, u16) {
        let w = winner as u64; let l = loser as u64;
        let delta = if (l >= w) {
            let d = RATING_BASE_CHANGE + (l - w) / 25; if (d > 28) 28 else d
        } else {
            let gap = (w - l) / 25; if (gap >= RATING_BASE_CHANGE - 4) 4 else RATING_BASE_CHANGE - gap
        };
        let new_w = if (w + delta > 65535) 65535 else w + delta;
        let new_l = if (l < (RATING_MIN as u64) + delta) (RATING_MIN as u64) else l - delta;
        ((new_w as u16), (new_l as u16))
    }

    // ===== Accessors =====
    public fun status(war: &GuildWar): u8 { war.status }
    public fun guild_a(war: &GuildWar): ID { war.guild_a }
    public fun guild_b(war: &GuildWar): ID { war.guild_b }
    public fun team_size(war: &GuildWar): u64 { war.team_size }
    public fun stake(war: &GuildWar): u64 { war.stake }
    public fun level_range(war: &GuildWar): (u8, u8) { (war.level_min, war.level_max) }
    public fun start_at(war: &GuildWar): u64 { war.start_at }
    public fun started_at(war: &GuildWar): u64 { war.started_at }
    public fun side_a(war: &GuildWar): vector<address> { war.side_a }
    public fun side_b(war: &GuildWar): vector<address> { war.side_b }
    public fun escrow_value(war: &GuildWar): u64 { balance::value(&war.escrow) }
    public fun winner(war: &GuildWar): u8 { war.winner }
    public fun in_war(registry: &WarRegistry, who: address): bool { table::contains(&registry.fighters, who) }
    public fun side_a_id(): u8 { SIDE_A }
    public fun side_b_id(): u8 { SIDE_B }
    public fun draw_id(): u8 { DRAW }
    public fun status_active(): u8 { STATUS_ACTIVE }
    public fun status_settled(): u8 { STATUS_SETTLED }
    public fun status_cancelled(): u8 { STATUS_CANCELLED }

    /// v5.3 — version gate for WarRegistry (see version.move).
    public(package) fun check_registry_version(x: &WarRegistry) { version::check(x.version); }
    /// v5.3 — permissionless: move a WarRegistry to the current package version.
    public fun migrate_registry(x: &mut WarRegistry) { x.version = version::next(x.version); }

    /// v5.3 — version gate for GuildWar (see version.move).
    public(package) fun check_war_version(x: &GuildWar) { version::check(x.version); }
    /// v5.3 — permissionless: move a GuildWar to the current package version.
    public fun migrate_war(x: &mut GuildWar) { x.version = version::next(x.version); }
}
