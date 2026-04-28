#[allow(lint(self_transfer, share_owned))]
module sui_combats::character {
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use std::string::String;

    // ===== Error constants =====
    const EInvalidStatTotal: u64 = 0;
    const EXpTooHigh: u64 = 1;
    const ENotEnoughPoints: u64 = 2;
    const ENameTooLong: u64 = 3;
    const ELockTooLong: u64 = 4;
    const ENotOwner: u64 = 5;

    // ===== Fight-lock dynamic field key (u64 unix-ms expiry) =====
    const LOCK_KEY: vector<u8> = b"fight_lock_expires_at";

    // ===== Game constants =====
    const MAX_LEVEL: u8 = 20;
    const INITIAL_STAT_POINTS: u16 = 20;
    const POINTS_PER_LEVEL: u16 = 3;
    const MAX_NAME_LENGTH: u64 = 32;
    const DEFAULT_RATING: u16 = 1000;

    // ===== Hardening caps =====
    /// Largest XP delta the server (AdminCap holder) can grant in a single fight.
    /// Server-side max today is ~400 (won wager vs +200 ELO opponent); this gives
    /// 2.5× headroom for tournaments / events while bounding admin-key compromise.
    const MAX_XP_PER_FIGHT: u64 = 1000;

    /// Longest fight-lock duration the server can set in one call. 1 hour absorbs
    /// any reasonable fight + settlement + retry window. Prevents accidental or
    /// malicious 999-year locks if the AdminCap leaks.
    const MAX_LOCK_MS: u64 = 3_600_000;

    // ===== AdminCap — minted once at init, held by server/treasury =====
    public struct AdminCap has key, store { id: UID }

    // ===== Character shared object =====
    // Equipment lives ONLY in dynamic object fields keyed by slot name.
    // No parallel Option<ID> pointers: DOFs are the single source of truth.
    public struct Character has key {
        id: UID,
        owner: address,
        name: String,
        level: u8,
        xp: u64,
        // Core stats
        strength: u16,
        dexterity: u16,
        intuition: u16,
        endurance: u16,
        // Unallocated stat points (granted on level-up, spent via allocate_points)
        unallocated_points: u16,
        // Combat record
        wins: u32,
        losses: u32,
        rating: u16,
        // Timestamps
        created_at: u64,
        last_updated: u64,
        // Bumped by equipment::save_loadout — anti-cheat + indexer hint
        loadout_version: u64,
    }

    // ===== Events =====
    public struct CharacterCreated has copy, drop {
        character_id: ID,
        name: String,
        owner: address,
        strength: u16,
        dexterity: u16,
        intuition: u16,
        endurance: u16,
    }

    public struct LevelUp has copy, drop {
        character_id: ID,
        owner: address,
        new_level: u8,
        xp: u64,
        unallocated_points: u16,
    }

    public struct FightResultUpdated has copy, drop {
        character_id: ID,
        owner: address,
        won: bool,
        xp_gained: u64,
        new_xp: u64,
        new_rating: u16,
        new_wins: u32,
        new_losses: u32,
    }

    public struct PointsAllocated has copy, drop {
        character_id: ID,
        owner: address,
        strength_added: u16,
        dexterity_added: u16,
        intuition_added: u16,
        endurance_added: u16,
        remaining_points: u16,
    }

    // ===== Init — mint single AdminCap to the deployer =====
    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    #[test_only]
    public fun xp_for_level_for_testing(level: u8): u64 {
        xp_for_level(level)
    }

    // ===== XP curve (production values per GDD §9.1) =====
    // Anchors: L2=100, L5=1500, L10=50k, L15=350k, L20=1M.
    // Intermediate levels interpolated geometrically.
    fun xp_for_level(level: u8): u64 {
        if (level <= 1) { 0 }
        else if (level == 2) { 100 }
        else if (level == 3) { 300 }
        else if (level == 4) { 700 }
        else if (level == 5) { 1500 }
        else if (level == 6) { 3000 }
        else if (level == 7) { 6000 }
        else if (level == 8) { 12000 }
        else if (level == 9) { 25000 }
        else if (level == 10) { 50000 }
        else if (level == 11) { 80000 }
        else if (level == 12) { 120000 }
        else if (level == 13) { 170000 }
        else if (level == 14) { 250000 }
        else if (level == 15) { 350000 }
        else if (level == 16) { 430000 }
        else if (level == 17) { 550000 }
        else if (level == 18) { 700000 }
        else if (level == 19) { 850000 }
        else if (level == 20) { 1000000 }
        else { 1000000 }
    }

    // ===== Public entry functions =====

    /// Mint a new character. Stat sum must equal INITIAL_STAT_POINTS (20).
    /// Character is shared so the server can update it via AdminCap.
    public fun create_character(
        name: String,
        str: u16,
        dex: u16,
        int: u16,
        end: u16,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(name.length() <= MAX_NAME_LENGTH, ENameTooLong);
        assert!(str + dex + int + end == INITIAL_STAT_POINTS, EInvalidStatTotal);

        let player = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);

        let character = Character {
            id: object::new(ctx),
            owner: player,
            name,
            level: 1,
            xp: 0,
            strength: str,
            dexterity: dex,
            intuition: int,
            endurance: end,
            unallocated_points: 0,
            wins: 0,
            losses: 0,
            rating: DEFAULT_RATING,
            created_at: now,
            last_updated: now,
            loadout_version: 0,
        };

        let character_id = object::id(&character);

        event::emit(CharacterCreated {
            character_id,
            name: character.name,
            owner: player,
            strength: str,
            dexterity: dex,
            intuition: int,
            endurance: end,
        });

        transfer::share_object(character);
    }

    /// Server (AdminCap holder) persists fight result. Aborts if `xp_gained`
    /// exceeds MAX_XP_PER_FIGHT — bounds blast radius if the admin key leaks.
    /// Auto-levels up while xp crosses thresholds, granting POINTS_PER_LEVEL each.
    public fun update_after_fight(
        _admin: &AdminCap,
        character: &mut Character,
        won: bool,
        xp_gained: u64,
        new_rating: u16,
        clock: &Clock,
    ) {
        assert!(xp_gained <= MAX_XP_PER_FIGHT, EXpTooHigh);

        if (won) {
            character.wins = character.wins + 1;
        } else {
            character.losses = character.losses + 1;
        };

        character.rating = new_rating;
        character.xp = character.xp + xp_gained;

        while (character.level < MAX_LEVEL) {
            let next_level = character.level + 1;
            let required_xp = xp_for_level(next_level);
            if (character.xp >= required_xp) {
                character.level = next_level;
                character.unallocated_points = character.unallocated_points + POINTS_PER_LEVEL;

                event::emit(LevelUp {
                    character_id: object::id(character),
                    owner: character.owner,
                    new_level: character.level,
                    xp: character.xp,
                    unallocated_points: character.unallocated_points,
                });
            } else {
                break
            }
        };

        character.last_updated = clock::timestamp_ms(clock);

        event::emit(FightResultUpdated {
            character_id: object::id(character),
            owner: character.owner,
            won,
            xp_gained,
            new_xp: character.xp,
            new_rating,
            new_wins: character.wins,
            new_losses: character.losses,
        });
    }

    /// Owner-only. Spend up to `unallocated_points` across stats.
    public fun allocate_points(
        character: &mut Character,
        str: u16,
        dex: u16,
        int: u16,
        end: u16,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == character.owner, ENotOwner);

        let total = str + dex + int + end;
        assert!(total > 0 && total <= character.unallocated_points, ENotEnoughPoints);

        character.unallocated_points = character.unallocated_points - total;
        character.strength = character.strength + str;
        character.dexterity = character.dexterity + dex;
        character.intuition = character.intuition + int;
        character.endurance = character.endurance + end;

        event::emit(PointsAllocated {
            character_id: object::id(character),
            owner: character.owner,
            strength_added: str,
            dexterity_added: dex,
            intuition_added: int,
            endurance_added: end,
            remaining_points: character.unallocated_points,
        });
    }

    // ===== Fight-lock (admin-gated proof equipment cannot change mid-fight) =====

    /// Set or extend the fight-lock expiry. `expires_at_ms = 0` clears any lock.
    /// Aborts if the requested expiry is more than MAX_LOCK_MS in the future
    /// (bounds blast radius of an admin-key compromise + accidental long locks).
    public fun set_fight_lock(
        _admin: &AdminCap,
        character: &mut Character,
        expires_at_ms: u64,
        clock: &Clock,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(
            expires_at_ms == 0 || expires_at_ms <= now + MAX_LOCK_MS,
            ELockTooLong,
        );

        let uid = &mut character.id;
        if (df::exists_<vector<u8>>(uid, LOCK_KEY)) {
            let slot: &mut u64 = df::borrow_mut(uid, LOCK_KEY);
            *slot = expires_at_ms;
        } else if (expires_at_ms > 0) {
            df::add(uid, LOCK_KEY, expires_at_ms);
        };
    }

    /// True iff the character has an unexpired fight lock. Auto-expires once
    /// `clock::timestamp_ms > stored_expires_at_ms` — no cleanup call needed.
    public fun is_fight_locked(character: &Character, clock: &Clock): bool {
        let uid = &character.id;
        if (!df::exists_<vector<u8>>(uid, LOCK_KEY)) return false;
        let expires: &u64 = df::borrow(uid, LOCK_KEY);
        *expires > clock::timestamp_ms(clock)
    }

    // ===== Package-internal helpers (used by equipment module only) =====

    public(package) fun uid(character: &Character): &UID { &character.id }

    public(package) fun uid_mut(character: &mut Character): &mut UID {
        &mut character.id
    }

    /// Increment loadout_version and return the new value. Called by
    /// equipment::save_loadout as the final command in a save PTB.
    public(package) fun bump_loadout_version(character: &mut Character): u64 {
        character.loadout_version = character.loadout_version + 1;
        character.loadout_version
    }

    // ===== Read-only accessors =====

    public fun owner(character: &Character): address { character.owner }
    public fun level(character: &Character): u8 { character.level }
    public fun xp(character: &Character): u64 { character.xp }
    public fun unallocated_points(character: &Character): u16 { character.unallocated_points }
    public fun strength(character: &Character): u16 { character.strength }
    public fun dexterity(character: &Character): u16 { character.dexterity }
    public fun intuition(character: &Character): u16 { character.intuition }
    public fun endurance(character: &Character): u16 { character.endurance }
    public fun wins(character: &Character): u32 { character.wins }
    public fun losses(character: &Character): u32 { character.losses }
    public fun rating(character: &Character): u16 { character.rating }
    public fun name(character: &Character): String { character.name }
    public fun created_at(character: &Character): u64 { character.created_at }
    public fun last_updated(character: &Character): u64 { character.last_updated }
    public fun loadout_version(character: &Character): u64 { character.loadout_version }
}
