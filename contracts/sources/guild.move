/// v5.3 — Guilds (clans). Added via package upgrade, so this module's
/// `init` never runs: the shared GuildRegistry is created exactly once by
/// `create_guild_registry` (AdminCap-gated, guarded by a one-time marker on
/// the CharacterRegistry).
///
/// Rules:
///   - Creating a guild costs exactly GUILD_CREATION_FEE (1 SUI) → TREASURY.
///   - Up to MAX_MEMBERS (30) members. Roles: MEMBER < OFFICER < LEADER.
///   - One guild per wallet, enforced chain-side by GuildRegistry.members.
///   - Guild names are unique case-insensitively (ASCII letters, digits,
///     space, '_' and '-'; 3..24 bytes; no leading/trailing/double spaces).
///   - Join is open (anyone) or invite-only; leader picks.
///   - Shared SUI treasury: any member can donate, only the leader can
///     withdraw. Every movement emits an event for transparency.
///   - `war_locked_until` freezes membership + treasury while a guild war is
///     in progress. Set only from inside this package (future guild-war
///     module); always 0 until then.
#[allow(lint(self_transfer))]
module sui_combats::guild {
    use std::string::{Self, String};
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::table::{Self, Table};
    use sui::vec_set::{Self, VecSet};
    use sui::dynamic_field as df;
    use sui_combats::character::{Self, AdminCap, Character, CharacterRegistry};
    use sui_combats::arena;

    // ===== Error constants =====
    const ERegistryExists: u64 = 0;
    const ENotCharacterOwner: u64 = 1;
    const EAlreadyInGuild: u64 = 2;
    const EWrongFee: u64 = 3;
    const EInvalidName: u64 = 4;
    const ENameTaken: u64 = 5;
    const ENotMember: u64 = 6;
    const ENotLeader: u64 = 7;
    const ENotOfficer: u64 = 8;
    const EGuildFull: u64 = 9;
    const ENotInvited: u64 = 10;
    const ELeaderCannotLeave: u64 = 11;
    const ECannotTargetSelf: u64 = 12;
    const EInsufficientRank: u64 = 13;
    const EInvalidRoleChange: u64 = 14;
    const EInsufficientFunds: u64 = 15;
    const EGuildNotEmpty: u64 = 16;
    const EWarLocked: u64 = 17;
    const ETooManyInvites: u64 = 18;
    const EAlreadyInvited: u64 = 19;
    const ETextTooLong: u64 = 20;
    const EZeroAmount: u64 = 21;
    const EAlreadyMember: u64 = 22;
    const EWarLockTooLong: u64 = 23;
    /// v5.3 — guild already has an open (declared / accepted / active) war.
    const EOpenWar: u64 = 24;

    // ===== Roles =====
    const ROLE_MEMBER: u8 = 0;
    const ROLE_OFFICER: u8 = 1;
    const ROLE_LEADER: u8 = 2;

    // ===== Limits =====
    const GUILD_CREATION_FEE: u64 = 1_000_000_000; // 1 SUI
    const MAX_MEMBERS: u64 = 30;
    const MAX_PENDING_INVITES: u64 = 50;
    const MIN_NAME_LEN: u64 = 3;
    const MAX_NAME_LEN: u64 = 24;
    const MAX_DESCRIPTION_LEN: u64 = 280;
    const MAX_EMBLEM_URL_LEN: u64 = 256;
    /// Upper bound for a single war-lock so a bug in a future war module can
    /// never freeze a guild indefinitely.
    const MAX_WAR_LOCK_MS: u64 = 7_200_000; // 2 hours
    const DEFAULT_RATING: u16 = 1000;

    // ===== Objects =====

    /// Shared. Chain-side source of truth for one-guild-per-wallet and
    /// unique (case-insensitive) guild names.
    public struct GuildRegistry has key {
        id: UID,
        /// member wallet → guild id
        members: Table<address, ID>,
        /// lowercase name → guild id
        names: Table<String, ID>,
        guild_count: u64,
    }

    /// Dynamic-field key planted on the CharacterRegistry the first time
    /// `create_guild_registry` runs. Value = the GuildRegistry id.
    public struct GuildRegistryMarker has copy, drop, store {}

    /// Shared guild object.
    public struct Guild has key {
        id: UID,
        name: String,
        description: String,
        emblem_url: String,
        leader: address,
        /// wallet → role
        members: Table<address, u8>,
        member_count: u64,
        open: bool,
        invites: VecSet<address>,
        treasury: Balance<SUI>,
        wins: u32,
        losses: u32,
        draws: u32,
        rating: u16,
        war_locked_until: u64,
        created_at: u64,
        /// v5.3 — the guild's current open GuildWar (declared, accepted or
        /// active). One at a time. Set / cleared only by guild_war.
        open_war: Option<ID>,
    }

    // ===== Events =====
    public struct GuildRegistryCreated has copy, drop { registry_id: ID }
    public struct GuildCreated has copy, drop { guild_id: ID, name: String, leader: address, open: bool }
    public struct GuildDisbanded has copy, drop { guild_id: ID, name: String, leader: address, treasury_payout: u64 }
    public struct MemberJoined has copy, drop { guild_id: ID, member: address, via_invite: bool }
    /// reason: 0 = left, 1 = kicked
    public struct MemberLeft has copy, drop { guild_id: ID, member: address, reason: u8, by: address }
    public struct MemberInvited has copy, drop { guild_id: ID, invitee: address, by: address }
    public struct InviteRevoked has copy, drop { guild_id: ID, invitee: address, by: address }
    public struct RoleChanged has copy, drop { guild_id: ID, member: address, new_role: u8, by: address }
    public struct LeadershipTransferred has copy, drop { guild_id: ID, old_leader: address, new_leader: address }
    public struct TreasuryDeposit has copy, drop { guild_id: ID, from: address, amount: u64, new_balance: u64 }
    public struct TreasuryWithdrawal has copy, drop { guild_id: ID, to: address, amount: u64, new_balance: u64 }
    public struct GuildSettingsUpdated has copy, drop { guild_id: ID, open: bool }

    // ===== Registry bootstrap (one-time) =====

    /// Creates + shares the single GuildRegistry. AdminCap-gated; a marker on
    /// the CharacterRegistry makes a second call abort ERegistryExists.
    public fun create_guild_registry(
        _admin: &AdminCap,
        char_registry: &mut CharacterRegistry,
        ctx: &mut TxContext,
    ) {
        let marker_host = character::registry_uid_mut(char_registry);
        assert!(!df::exists_(marker_host, GuildRegistryMarker {}), ERegistryExists);

        let registry = GuildRegistry {
            id: object::new(ctx),
            members: table::new<address, ID>(ctx),
            names: table::new<String, ID>(ctx),
            guild_count: 0,
        };
        let registry_id = object::id(&registry);
        df::add(marker_host, GuildRegistryMarker {}, registry_id);

        event::emit(GuildRegistryCreated { registry_id });
        transfer::share_object(registry);
    }

    // ===== Lifecycle =====

    /// Found a new guild. Sender must own `founder_character`, not already be
    /// in a guild, and pay exactly GUILD_CREATION_FEE.
    public fun create_guild(
        registry: &mut GuildRegistry,
        founder_character: &Character,
        name: String,
        open: bool,
        fee: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(character::owner(founder_character) == sender, ENotCharacterOwner);
        assert!(!table::contains(&registry.members, sender), EAlreadyInGuild);
        assert!(coin::value(&fee) == GUILD_CREATION_FEE, EWrongFee);

        let key = normalize_name(&name);
        assert!(!table::contains(&registry.names, key), ENameTaken);

        let mut members = table::new<address, u8>(ctx);
        table::add(&mut members, sender, ROLE_LEADER);

        let guild = Guild {
            id: object::new(ctx),
            name,
            description: string::utf8(b""),
            emblem_url: string::utf8(b""),
            leader: sender,
            members,
            member_count: 1,
            open,
            invites: vec_set::empty(),
            treasury: balance::zero(),
            wins: 0,
            losses: 0,
            draws: 0,
            rating: DEFAULT_RATING,
            war_locked_until: 0,
            created_at: clock::timestamp_ms(clock),
            open_war: option::none(),
        };
        let guild_id = object::id(&guild);

        table::add(&mut registry.names, key, guild_id);
        table::add(&mut registry.members, sender, guild_id);
        registry.guild_count = registry.guild_count + 1;

        transfer::public_transfer(fee, arena::treasury_address());

        event::emit(GuildCreated { guild_id, name: guild.name, leader: sender, open });
        transfer::share_object(guild);
    }

    /// Leader dissolves the guild. Only allowed when the leader is the last
    /// member. Any treasury balance is paid to the leader. The shared object
    /// is deleted (storage rebate goes to the caller).
    public fun disband_guild(
        guild: Guild,
        registry: &mut GuildRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(sender == guild.leader, ENotLeader);
        assert!(guild.member_count == 1, EGuildNotEmpty);
        assert_not_war_locked(&guild, clock);
        assert!(option::is_none(&guild.open_war), EOpenWar);

        let guild_id = object::id(&guild);
        let Guild {
            id,
            name,
            description: _,
            emblem_url: _,
            leader,
            mut members,
            member_count: _,
            open: _,
            invites: _,
            mut treasury,
            wins: _,
            losses: _,
            draws: _,
            rating: _,
            war_locked_until: _,
            created_at: _,
            open_war: _,
        } = guild;

        let payout = balance::value(&treasury);
        if (payout > 0) {
            let coin = coin::from_balance(balance::withdraw_all(&mut treasury), ctx);
            transfer::public_transfer(coin, leader);
        };
        balance::destroy_zero(treasury);

        let _ = table::remove(&mut members, leader);
        table::destroy_empty(members);

        let _ = table::remove(&mut registry.members, leader);
        let _ = table::remove(&mut registry.names, normalize_name(&name));
        registry.guild_count = registry.guild_count - 1;

        object::delete(id);
        event::emit(GuildDisbanded { guild_id, name, leader, treasury_payout: payout });
    }

    // ===== Membership =====

    /// Join a guild. Open guilds accept anyone; invite-only guilds require a
    /// pending invite for the sender (consumed on join).
    public fun join_guild(
        guild: &mut Guild,
        registry: &mut GuildRegistry,
        character: &Character,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(character::owner(character) == sender, ENotCharacterOwner);
        assert!(!table::contains(&registry.members, sender), EAlreadyInGuild);
        assert_not_war_locked(guild, clock);
        assert!(guild.member_count < MAX_MEMBERS, EGuildFull);

        let invited = vec_set::contains(&guild.invites, &sender);
        assert!(guild.open || invited, ENotInvited);
        if (invited) {
            vec_set::remove(&mut guild.invites, &sender);
        };

        let guild_id = object::id(guild);
        table::add(&mut guild.members, sender, ROLE_MEMBER);
        guild.member_count = guild.member_count + 1;
        table::add(&mut registry.members, sender, guild_id);

        event::emit(MemberJoined { guild_id, member: sender, via_invite: invited });
    }

    /// Non-leader member leaves. The leader must transfer leadership or
    /// disband instead.
    public fun leave_guild(
        guild: &mut Guild,
        registry: &mut GuildRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(table::contains(&guild.members, sender), ENotMember);
        assert!(sender != guild.leader, ELeaderCannotLeave);
        assert_not_war_locked(guild, clock);

        remove_member(guild, registry, sender);
        event::emit(MemberLeft { guild_id: object::id(guild), member: sender, reason: 0, by: sender });
    }

    /// Remove a member. Actor must strictly outrank the target
    /// (leader kicks officers/members, officers kick members).
    public fun kick_member(
        guild: &mut Guild,
        registry: &mut GuildRegistry,
        member: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(member != sender, ECannotTargetSelf);
        let actor_role = role_or_abort(guild, sender);
        assert!(actor_role >= ROLE_OFFICER, ENotOfficer);
        let target_role = role_or_abort(guild, member);
        assert!(actor_role > target_role, EInsufficientRank);
        assert_not_war_locked(guild, clock);

        remove_member(guild, registry, member);
        event::emit(MemberLeft { guild_id: object::id(guild), member, reason: 1, by: sender });
    }

    /// Leader or officer invites a wallet. The invitee may currently be in
    /// another guild; they must leave it before accepting.
    public fun invite_member(
        guild: &mut Guild,
        invitee: address,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(role_or_abort(guild, sender) >= ROLE_OFFICER, ENotOfficer);
        assert!(!table::contains(&guild.members, invitee), EAlreadyMember);
        assert!(!vec_set::contains(&guild.invites, &invitee), EAlreadyInvited);
        assert!(vec_set::length(&guild.invites) < MAX_PENDING_INVITES, ETooManyInvites);

        vec_set::insert(&mut guild.invites, invitee);
        event::emit(MemberInvited { guild_id: object::id(guild), invitee, by: sender });
    }

    /// Leader or officer withdraws a pending invite.
    public fun revoke_invite(
        guild: &mut Guild,
        invitee: address,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(role_or_abort(guild, sender) >= ROLE_OFFICER, ENotOfficer);
        assert!(vec_set::contains(&guild.invites, &invitee), ENotInvited);

        vec_set::remove(&mut guild.invites, &invitee);
        event::emit(InviteRevoked { guild_id: object::id(guild), invitee, by: sender });
    }

    /// Invitee declines their own pending invite.
    public fun decline_invite(guild: &mut Guild, ctx: &mut TxContext) {
        let sender = ctx.sender();
        assert!(vec_set::contains(&guild.invites, &sender), ENotInvited);

        vec_set::remove(&mut guild.invites, &sender);
        event::emit(InviteRevoked { guild_id: object::id(guild), invitee: sender, by: sender });
    }

    // ===== Roles =====

    /// Leader promotes a MEMBER to OFFICER.
    public fun promote_to_officer(guild: &mut Guild, member: address, ctx: &mut TxContext) {
        let sender = ctx.sender();
        assert!(sender == guild.leader, ENotLeader);
        assert!(role_or_abort(guild, member) == ROLE_MEMBER, EInvalidRoleChange);

        *table::borrow_mut(&mut guild.members, member) = ROLE_OFFICER;
        event::emit(RoleChanged { guild_id: object::id(guild), member, new_role: ROLE_OFFICER, by: sender });
    }

    /// Leader demotes an OFFICER to MEMBER.
    public fun demote_to_member(guild: &mut Guild, member: address, ctx: &mut TxContext) {
        let sender = ctx.sender();
        assert!(sender == guild.leader, ENotLeader);
        assert!(role_or_abort(guild, member) == ROLE_OFFICER, EInvalidRoleChange);

        *table::borrow_mut(&mut guild.members, member) = ROLE_MEMBER;
        event::emit(RoleChanged { guild_id: object::id(guild), member, new_role: ROLE_MEMBER, by: sender });
    }

    /// Leader hands leadership to another member. The old leader becomes an
    /// OFFICER.
    public fun transfer_leadership(guild: &mut Guild, new_leader: address, ctx: &mut TxContext) {
        let sender = ctx.sender();
        assert!(sender == guild.leader, ENotLeader);
        assert!(new_leader != sender, ECannotTargetSelf);
        let _ = role_or_abort(guild, new_leader);

        *table::borrow_mut(&mut guild.members, new_leader) = ROLE_LEADER;
        *table::borrow_mut(&mut guild.members, sender) = ROLE_OFFICER;
        guild.leader = new_leader;

        event::emit(LeadershipTransferred { guild_id: object::id(guild), old_leader: sender, new_leader });
    }

    // ===== Settings =====

    public fun set_open(guild: &mut Guild, open: bool, ctx: &mut TxContext) {
        assert!(ctx.sender() == guild.leader, ENotLeader);
        guild.open = open;
        event::emit(GuildSettingsUpdated { guild_id: object::id(guild), open });
    }

    public fun set_profile(
        guild: &mut Guild,
        description: String,
        emblem_url: String,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == guild.leader, ENotLeader);
        assert!(description.length() <= MAX_DESCRIPTION_LEN, ETextTooLong);
        assert!(emblem_url.length() <= MAX_EMBLEM_URL_LEN, ETextTooLong);
        guild.description = description;
        guild.emblem_url = emblem_url;
        event::emit(GuildSettingsUpdated { guild_id: object::id(guild), open: guild.open });
    }

    // ===== Treasury =====

    /// Any member donates SUI to the guild treasury.
    public fun donate(guild: &mut Guild, payment: Coin<SUI>, ctx: &mut TxContext) {
        let sender = ctx.sender();
        assert!(table::contains(&guild.members, sender), ENotMember);
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);

        balance::join(&mut guild.treasury, coin::into_balance(payment));
        event::emit(TreasuryDeposit {
            guild_id: object::id(guild),
            from: sender,
            amount,
            new_balance: balance::value(&guild.treasury),
        });
    }

    /// Leader withdraws `amount` from the treasury to their own wallet.
    /// Blocked while war-locked (the treasury may back a war stake).
    public fun withdraw(guild: &mut Guild, amount: u64, clock: &Clock, ctx: &mut TxContext) {
        let sender = ctx.sender();
        assert!(sender == guild.leader, ENotLeader);
        assert!(amount > 0, EZeroAmount);
        assert!(amount <= balance::value(&guild.treasury), EInsufficientFunds);
        assert_not_war_locked(guild, clock);

        let coin = coin::from_balance(balance::split(&mut guild.treasury, amount), ctx);
        transfer::public_transfer(coin, sender);
        event::emit(TreasuryWithdrawal {
            guild_id: object::id(guild),
            to: sender,
            amount,
            new_balance: balance::value(&guild.treasury),
        });
    }

    // ===== Package-internal hooks (future guild-war module) =====

    /// Freeze membership + treasury until `until_ms`. Bounded by
    /// MAX_WAR_LOCK_MS from now; pass 0 to release.
    public(package) fun set_war_lock(guild: &mut Guild, until_ms: u64, clock: &Clock) {
        if (until_ms != 0) {
            assert!(until_ms <= clock::timestamp_ms(clock) + MAX_WAR_LOCK_MS, EWarLockTooLong);
        };
        guild.war_locked_until = until_ms;
    }

    /// v5.3 — mark / clear the guild's open war (guild_war module only).
    public(package) fun set_open_war(guild: &mut Guild, war_id: ID) {
        assert!(option::is_none(&guild.open_war), EOpenWar);
        guild.open_war = option::some(war_id);
    }

    public(package) fun clear_open_war(guild: &mut Guild, war_id: ID) {
        if (option::is_some(&guild.open_war) && *option::borrow(&guild.open_war) == war_id) {
            guild.open_war = option::none();
        };
    }

    /// Record a finished guild-war result.
    /// outcome: 0 = loss, 1 = win, 2 = draw.
    public(package) fun record_war_result(guild: &mut Guild, outcome: u8, new_rating: u16) {
        if (outcome == 1) {
            guild.wins = guild.wins + 1;
        } else if (outcome == 0) {
            guild.losses = guild.losses + 1;
        } else {
            guild.draws = guild.draws + 1;
        };
        guild.rating = new_rating;
    }

    // ===== Internal helpers =====

    fun remove_member(guild: &mut Guild, registry: &mut GuildRegistry, member: address) {
        let _ = table::remove(&mut guild.members, member);
        guild.member_count = guild.member_count - 1;
        let _ = table::remove(&mut registry.members, member);
    }

    fun role_or_abort(guild: &Guild, who: address): u8 {
        assert!(table::contains(&guild.members, who), ENotMember);
        *table::borrow(&guild.members, who)
    }

    fun assert_not_war_locked(guild: &Guild, clock: &Clock) {
        assert!(clock::timestamp_ms(clock) >= guild.war_locked_until, EWarLocked);
    }

    /// Validates a guild name and returns its lowercase registry key.
    /// Allowed: A-Z a-z 0-9 space '_' '-'; MIN..MAX_NAME_LEN bytes; no
    /// leading, trailing or consecutive spaces.
    fun normalize_name(name: &String): String {
        let bytes = name.as_bytes();
        let len = bytes.length();
        assert!(len >= MIN_NAME_LEN && len <= MAX_NAME_LEN, EInvalidName);
        assert!(bytes[0] != 32 && bytes[len - 1] != 32, EInvalidName);

        let mut key = vector<u8>[];
        let mut prev_space = false;
        let mut i = 0;
        while (i < len) {
            let c = bytes[i];
            let is_upper = c >= 65 && c <= 90;
            let is_lower = c >= 97 && c <= 122;
            let is_digit = c >= 48 && c <= 57;
            let is_space = c == 32;
            assert!(is_upper || is_lower || is_digit || is_space || c == 95 || c == 45, EInvalidName);
            assert!(!(is_space && prev_space), EInvalidName);
            key.push_back(if (is_upper) c + 32 else c);
            prev_space = is_space;
            i = i + 1;
        };
        string::utf8(key)
    }

    // ===== Read-only accessors =====
    public fun name(guild: &Guild): String { guild.name }
    public fun description(guild: &Guild): String { guild.description }
    public fun emblem_url(guild: &Guild): String { guild.emblem_url }
    public fun leader(guild: &Guild): address { guild.leader }
    public fun member_count(guild: &Guild): u64 { guild.member_count }
    public fun is_open(guild: &Guild): bool { guild.open }
    public fun is_member(guild: &Guild, who: address): bool { table::contains(&guild.members, who) }
    public fun role_of(guild: &Guild, who: address): u8 { role_or_abort(guild, who) }
    public fun is_invited(guild: &Guild, who: address): bool { vec_set::contains(&guild.invites, &who) }
    public fun treasury_value(guild: &Guild): u64 { balance::value(&guild.treasury) }
    public fun wins(guild: &Guild): u32 { guild.wins }
    public fun losses(guild: &Guild): u32 { guild.losses }
    public fun draws(guild: &Guild): u32 { guild.draws }
    public fun rating(guild: &Guild): u16 { guild.rating }
    public fun war_locked_until(guild: &Guild): u64 { guild.war_locked_until }
    public fun open_war(guild: &Guild): Option<ID> { guild.open_war }
    public fun has_open_war(guild: &Guild): bool { option::is_some(&guild.open_war) }
    public fun created_at(guild: &Guild): u64 { guild.created_at }

    public fun registry_has_member(registry: &GuildRegistry, who: address): bool {
        table::contains(&registry.members, who)
    }
    public fun registry_guild_of(registry: &GuildRegistry, who: address): ID {
        *table::borrow(&registry.members, who)
    }
    public fun registry_name_taken(registry: &GuildRegistry, name: String): bool {
        table::contains(&registry.names, normalize_name(&name))
    }
    public fun guild_count(registry: &GuildRegistry): u64 { registry.guild_count }

    public fun creation_fee(): u64 { GUILD_CREATION_FEE }
    public fun max_members(): u64 { MAX_MEMBERS }
    public fun role_member(): u8 { ROLE_MEMBER }
    public fun role_officer(): u8 { ROLE_OFFICER }
    public fun role_leader(): u8 { ROLE_LEADER }
}
