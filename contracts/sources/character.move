module sui_combats::character {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use std::string::String;
    use std::option::{Self, Option};

    // ===== Error constants =====
    const EInvalidStatTotal: u64 = 0;
    const EMaxLevelReached: u64 = 1;
    const ENotEnoughPoints: u64 = 2;
    const ENameTooLong: u64 = 3;
    const EStatTooHigh: u64 = 4;

    // ===== Constants =====
    const MAX_LEVEL: u8 = 20;
    const INITIAL_STAT_POINTS: u16 = 20;
    const POINTS_PER_LEVEL: u16 = 3;
    const MAX_NAME_LENGTH: u64 = 32;
    const DEFAULT_RATING: u16 = 1000;
    const RATING_CHANGE: u16 = 25;

    // ===== Character struct =====
    public struct Character has key {
        id: UID,
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
        new_level: u8,
        xp: u64,
    }

    public struct PointsAllocated has copy, drop {
        character_id: ID,
        strength_added: u16,
        dexterity_added: u16,
        intuition_added: u16,
        endurance_added: u16,
    }

    // ===== XP thresholds for each level =====
    // Returns the cumulative XP needed to reach a given level.
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
        else if (level == 13) { 180000 }
        else if (level == 14) { 250000 }
        else if (level == 15) { 350000 }
        else if (level == 16) { 500000 }
        else if (level == 17) { 650000 }
        else if (level == 18) { 800000 }
        else if (level == 19) { 900000 }
        else if (level == 20) { 1000000 }
        else { 1000000 }
    }

    // ===== Public functions =====

    /// Create a new character with the given stat distribution.
    /// The total of str + dex + int + end must equal 20.
    public entry fun create_character(
        name: String,
        str: u16,
        dex: u16,
        int: u16,
        end: u16,
        ctx: &mut TxContext,
    ) {
        let name_bytes = std::string::bytes(&name);
        assert!(std::vector::length(name_bytes) <= MAX_NAME_LENGTH, ENameTooLong);
        assert!(str + dex + int + end == INITIAL_STAT_POINTS, EInvalidStatTotal);

        let character = Character {
            id: object::new(ctx),
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
        let owner = tx_context::sender(ctx);

        event::emit(CharacterCreated {
            character_id,
            name: character.name,
            owner,
            strength: str,
            dexterity: dex,
            intuition: int,
            endurance: end,
        });

        // Soulbound: use transfer (not public_transfer) so only this module can transfer it
        transfer::transfer(character, owner);
    }

    /// Add XP to a character and auto-level up if thresholds are met.
    public(package) fun add_xp(character: &mut Character, amount: u64) {
        assert!(character.level < MAX_LEVEL, EMaxLevelReached);

        character.xp = character.xp + amount;

        // Check for level-ups
        while (character.level < MAX_LEVEL) {
            let next_level = character.level + 1;
            let required_xp = xp_for_level(next_level);
            if (character.xp >= required_xp) {
                character.level = next_level;
                character.unallocated_points = character.unallocated_points + POINTS_PER_LEVEL;

                event::emit(LevelUp {
                    character_id: object::id(character),
                    new_level: character.level,
                    xp: character.xp,
                });
            } else {
                break
            }
        };
    }

    /// Allocate unallocated stat points to the four core stats.
    public entry fun allocate_points(
        character: &mut Character,
        str: u16,
        dex: u16,
        int: u16,
        end: u16,
    ) {
        let total = str + dex + int + end;
        assert!(total > 0 && total <= character.unallocated_points, ENotEnoughPoints);

        character.unallocated_points = character.unallocated_points - total;
        character.strength = character.strength + str;
        character.dexterity = character.dexterity + dex;
        character.intuition = character.intuition + int;
        character.endurance = character.endurance + end;

        event::emit(PointsAllocated {
            character_id: object::id(character),
            strength_added: str,
            dexterity_added: dex,
            intuition_added: int,
            endurance_added: end,
        });
    }

    /// Update win/loss record and rating after a match.
    public(package) fun update_record(character: &mut Character, won: bool) {
        if (won) {
            character.wins = character.wins + 1;
            character.rating = character.rating + RATING_CHANGE;
        } else {
            character.losses = character.losses + 1;
            if (character.rating >= RATING_CHANGE) {
                character.rating = character.rating - RATING_CHANGE;
            } else {
                character.rating = 0;
            };
        };
    }

    // ===== Accessor functions (used by other modules) =====

    public(package) fun uid_mut(character: &mut Character): &mut UID {
        &mut character.id
    }

    public fun uid(character: &Character): &UID {
        &character.id
    }

    public fun level(character: &Character): u8 {
        character.level
    }

    public fun strength(character: &Character): u16 {
        character.strength
    }

    public fun dexterity(character: &Character): u16 {
        character.dexterity
    }

    public fun intuition(character: &Character): u16 {
        character.intuition
    }

    public fun endurance(character: &Character): u16 {
        character.endurance
    }

    public fun rating(character: &Character): u16 {
        character.rating
    }

    public fun wins(character: &Character): u32 {
        character.wins
    }

    public fun losses(character: &Character): u32 {
        character.losses
    }

    public fun xp(character: &Character): u64 {
        character.xp
    }

    public fun name(character: &Character): String {
        character.name
    }

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
