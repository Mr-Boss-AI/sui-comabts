module sui_combats::character {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::String;
    use std::option::{Self, Option};

    // ===== Error constants =====
    const EInvalidStatTotal: u64 = 0;
    const EMaxLevelReached: u64 = 1;
    const ENotEnoughPoints: u64 = 2;
    const ENameTooLong: u64 = 3;
    const EStatTooHigh: u64 = 4;
    const ENotOwner: u64 = 5;

    // ===== Constants =====
    const MAX_LEVEL: u8 = 20;
    const INITIAL_STAT_POINTS: u16 = 20;
    const POINTS_PER_LEVEL: u16 = 3;
    const MAX_NAME_LENGTH: u64 = 32;
    const DEFAULT_RATING: u16 = 1000;

    // ===== AdminCap — minted once on publish, held by server =====
    public struct AdminCap has key, store {
        id: UID,
    }

    // ===== Character shared object =====
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
        // Unallocated stat points
        unallocated_points: u16,
        // Combat record
        wins: u32,
        losses: u32,
        rating: u16,
        // Timestamp of last on-chain update
        last_updated: u64,
        // Equipment slots (store ID references to equipped items)
        weapon: Option<ID>,
        offhand: Option<ID>,
        helmet: Option<ID>,
        chest: Option<ID>,
        gloves: Option<ID>,
        boots: Option<ID>,
        belt: Option<ID>,
        ring_1: Option<ID>,
        ring_2: Option<ID>,
        necklace: Option<ID>,
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

    // ===== Init — creates AdminCap and sends to deployer =====
    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    // ===== XP thresholds for each level =====
    fun xp_for_level(level: u8): u64 {
        // TESTING: lowered XP thresholds — revert before mainnet!
        if (level <= 1) { 0 }
        else if (level == 2) { 2 }
        else if (level == 3) { 5 }
        else if (level == 4) { 10 }
        else if (level == 5) { 20 }
        else if (level == 6) { 35 }
        else if (level == 7) { 55 }
        else if (level == 8) { 80 }
        else if (level == 9) { 110 }
        else if (level == 10) { 150 }
        else if (level == 11) { 200 }
        else if (level == 12) { 260 }
        else if (level == 13) { 330 }
        else if (level == 14) { 410 }
        else if (level == 15) { 500 }
        else if (level == 16) { 600 }
        else if (level == 17) { 710 }
        else if (level == 18) { 830 }
        else if (level == 19) { 960 }
        else if (level == 20) { 1100 }
        else { 1100 }
    }

    // ===== Public entry functions =====

    /// Create a new character. Shared object so the server can update it.
    /// The `owner` field ensures only the player can allocate stats.
    public entry fun create_character(
        name: String,
        str: u16,
        dex: u16,
        int: u16,
        end: u16,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let name_bytes = std::string::bytes(&name);
        assert!(std::vector::length(name_bytes) <= MAX_NAME_LENGTH, ENameTooLong);
        assert!(str + dex + int + end == INITIAL_STAT_POINTS, EInvalidStatTotal);

        let player = tx_context::sender(ctx);

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
            last_updated: clock::timestamp_ms(clock),
            weapon: option::none(),
            offhand: option::none(),
            helmet: option::none(),
            chest: option::none(),
            gloves: option::none(),
            boots: option::none(),
            belt: option::none(),
            ring_1: option::none(),
            ring_2: option::none(),
            necklace: option::none(),
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

    /// Server calls this after each fight to update the character on-chain.
    /// Requires AdminCap (only the server holds this).
    public entry fun update_after_fight(
        _admin: &AdminCap,
        character: &mut Character,
        won: bool,
        xp_gained: u64,
        new_rating: u16,
        clock: &Clock,
    ) {
        // Update win/loss
        if (won) {
            character.wins = character.wins + 1;
        } else {
            character.losses = character.losses + 1;
        };

        // Update rating
        character.rating = new_rating;

        // Add XP and check for level-ups
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

    /// Player allocates unallocated stat points. Only the character owner can call this.
    public entry fun allocate_points(
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

    // ===== Package-internal helpers (used by equipment module) =====

    public(package) fun uid_mut(character: &mut Character): &mut UID {
        &mut character.id
    }

    public fun uid(character: &Character): &UID {
        &character.id
    }

    // ===== Accessor functions =====

    public fun owner(character: &Character): address { character.owner }
    public fun level(character: &Character): u8 { character.level }
    public fun strength(character: &Character): u16 { character.strength }
    public fun dexterity(character: &Character): u16 { character.dexterity }
    public fun intuition(character: &Character): u16 { character.intuition }
    public fun endurance(character: &Character): u16 { character.endurance }
    public fun rating(character: &Character): u16 { character.rating }
    public fun wins(character: &Character): u32 { character.wins }
    public fun losses(character: &Character): u32 { character.losses }
    public fun xp(character: &Character): u64 { character.xp }
    public fun name(character: &Character): String { character.name }
    public fun unallocated_points(character: &Character): u16 { character.unallocated_points }
    public fun last_updated(character: &Character): u64 { character.last_updated }

    // Equipment slot accessors
    public fun weapon(character: &Character): Option<ID> { character.weapon }
    public fun offhand(character: &Character): Option<ID> { character.offhand }
    public fun helmet(character: &Character): Option<ID> { character.helmet }
    public fun chest(character: &Character): Option<ID> { character.chest }
    public fun gloves(character: &Character): Option<ID> { character.gloves }
    public fun boots(character: &Character): Option<ID> { character.boots }
    public fun belt(character: &Character): Option<ID> { character.belt }
    public fun ring_1(character: &Character): Option<ID> { character.ring_1 }
    public fun ring_2(character: &Character): Option<ID> { character.ring_2 }
    public fun necklace(character: &Character): Option<ID> { character.necklace }

    // Equipment slot setters (package-level for equipment module)
    public(package) fun set_weapon(character: &mut Character, id: Option<ID>) { character.weapon = id; }
    public(package) fun set_offhand(character: &mut Character, id: Option<ID>) { character.offhand = id; }
    public(package) fun set_helmet(character: &mut Character, id: Option<ID>) { character.helmet = id; }
    public(package) fun set_chest(character: &mut Character, id: Option<ID>) { character.chest = id; }
    public(package) fun set_gloves(character: &mut Character, id: Option<ID>) { character.gloves = id; }
    public(package) fun set_boots(character: &mut Character, id: Option<ID>) { character.boots = id; }
    public(package) fun set_belt(character: &mut Character, id: Option<ID>) { character.belt = id; }
    public(package) fun set_ring_1(character: &mut Character, id: Option<ID>) { character.ring_1 = id; }
    public(package) fun set_ring_2(character: &mut Character, id: Option<ID>) { character.ring_2 = id; }
    public(package) fun set_necklace(character: &mut Character, id: Option<ID>) { character.necklace = id; }
}
