#[allow(lint(self_transfer))]
module sui_combats::item {
    use sui::event;
    use sui::package;
    use std::string::String;

    use sui_combats::character::AdminCap;

    // ===== Error constants =====
    const EInvalidItemType: u64 = 0;
    // v5.3 — code 1 (EInvalidRarity) retired with rarity.
    const EBonusTooHigh: u64 = 2;
    const ELevelReqTooHigh: u64 = 3;
    const EDamageRangeInvalid: u64 = 4;
    /// v5.3 — Item's weighted flat-stat power exceeds max_flat_power(level_req).
    const EPowerBudgetExceeded: u64 = 5;
    /// v5.1 — Generic slot_type-shape mismatch (helmet/chest/etc with slot_type != 0).
    const EInvalidSlotType: u64 = 6;
    /// v5.1 — Weapon slot_type must be 0 (mainhand) or 2 (both_hands).
    const EWeaponSlotTypeInvalid: u64 = 7;
    // v5.3 — code 8 (ERarityLevelTooLow) retired with rarity.
    /// v5.3 — weapons and shields need level_req >= MIN_HAND_ITEM_LEVEL
    /// (levels 1-2 fight bare-handed).
    const EHandItemLevelTooLow: u64 = 9;
    /// v5.3 — Item's chance points (INT, crit %, evasion %, anti-crit %,
    /// anti-evasion %, crit damage) exceed MAX_CHANCE_POINTS.
    const EChancePointsExceeded: u64 = 10;
    /// v5.3 — level_req must be at least 1.
    const ELevelReqZero: u64 = 11;

    // ===== Item type constants =====
    const WEAPON: u8 = 1;
    const SHIELD: u8 = 2;
    const HELMET: u8 = 3;
    const CHEST: u8 = 4;
    const GLOVES: u8 = 5;
    const BOOTS: u8 = 6;
    const BELT: u8 = 7;
    const RING: u8 = 8;
    const NECKLACE: u8 = 9;
    /// v5.1 (2026-05-28 PM) — 2 new wearable types for the 13-slot loadout.
    /// (Third v5.1 slot is ring_3, which reuses the existing RING=8 type.)
    const PANTS: u8 = 10;
    const BRACELETS: u8 = 11;
    /// v5.3 — 14th slot.
    const EARRINGS: u8 = 12;


    // ===== Slot type constants (v5.1) =====
    /// Single-slot mainhand weapon. Goes in the weapon slot only.
    const SLOT_MAINHAND: u8 = 0;
    /// Offhand item — shield, off-hand weapon (dual-wield). Goes in offhand only.
    const SLOT_OFFHAND: u8 = 1;
    /// Two-handed weapon — reserves both weapon AND offhand slots.
    const SLOT_BOTH_HANDS: u8 = 2;

    // ===== Hardening caps =====
    /// Each stat-bonus field on a minted item may not exceed this value.
    /// Combat math uses u16/u32 intermediaries; 1000 leaves headroom for
    /// stacking up to 10 items (10 * 1000 = 10_000) without overflow risk.
    const MAX_BONUS: u16 = 1000;

    /// Items above MAX_LEVEL_REQ would be permanently unusable (max char level = 20).
    const MAX_LEVEL_REQ: u8 = 20;

    // ===== Level gates (v5.3) =====
    /// Weapons + shields start at this level; levels 1-2 are bare-handed.
    const MIN_HAND_ITEM_LEVEL: u8 = 3;


    // ===== Item power limits (v5.3 — no rarity tiers) =====
    // Every item is judged only by its level and stats. Two limits, both
    // derived from simulated fights (scripts/balance-sim.ts):
    //
    // 1. Flat power — stats whose value grows with level. Each point costs
    //    its fight value in HP-equivalents:
    //      HP 1 · ARM 7 · DEF 7 · ATK 7 · max_damage 6 · STR 5 · DEX 3 · END 7
    //    Cap = max_flat_power(level_req) ≈ 3 "edge units" at that level
    //    (0.477·L² + 4.62·L + 10.8). The design tables use far less; the cap
    //    only stops broken mints (e.g. ARM +100 at level 1).
    // 2. Chance points — stats worth about the same at every level:
    //      INT ×2 · crit % · evasion % · anti-crit % · anti-evasion % · crit dmg ÷10
    //    Cap = MAX_CHANCE_POINTS per item.
    const W_HP: u64 = 1;
    const W_ARMOR: u64 = 7;
    const W_DEFENSE: u64 = 7;
    const W_ATTACK: u64 = 7;
    const W_MAX_DAMAGE: u64 = 6;
    const W_STRENGTH: u64 = 5;
    const W_DEXTERITY: u64 = 3;
    const W_ENDURANCE: u64 = 7;
    const MAX_CHANCE_POINTS: u64 = 20;

    // ===== One-time witness for Publisher =====
    public struct ITEM has drop {}

    // ===== Item NFT =====
    public struct Item has key, store {
        id: UID,
        name: String,
        image_url: String,
        item_type: u8,
        class_req: u8,
        level_req: u8,
        /// v5.1 — slot_type enforces the shield-vs-dual-wield-vs-two-handed
        /// trinity. 0=mainhand, 1=offhand, 2=both_hands. equip_weapon /
        /// equip_offhand consume this field; the frontend reads it directly
        /// rather than maintaining a hardcoded TWO_HANDED_NAMES allowlist.
        slot_type: u8,
        // Stat bonuses
        strength_bonus: u16,
        dexterity_bonus: u16,
        intuition_bonus: u16,
        endurance_bonus: u16,
        hp_bonus: u16,
        armor_bonus: u16,
        defense_bonus: u16,
        attack_bonus: u16,
        crit_chance_bonus: u16,
        crit_multiplier_bonus: u16,
        evasion_bonus: u16,
        anti_crit_bonus: u16,
        anti_evasion_bonus: u16,
        // Weapon-specific damage range
        min_damage: u16,
        max_damage: u16,
    }

    // ===== Events =====
    public struct ItemMinted has copy, drop {
        item_id: ID,
        name: String,
        item_type: u8,
        level_req: u8,
        slot_type: u8,
        owner: address,
    }

    // ===== Init: claim Publisher (used later by marketplace::setup_transfer_policy) =====
    fun init(otw: ITEM, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);
        transfer::public_transfer(publisher, tx_context::sender(ctx));
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        let publisher = package::claim(ITEM {}, ctx);
        transfer::public_transfer(publisher, tx_context::sender(ctx));
    }

    /// v5.3 — Max weighted flat-stat power for an item of `level`.
    public fun max_flat_power(level: u8): u64 {
        let l = level as u64;
        (477 * l * l + 4620 * l + 10800) / 1000
    }

    /// v5.3 — Weighted flat-stat power (HP-equivalents).
    public fun flat_power(
        strength: u16, dexterity: u16, endurance: u16, hp: u16,
        armor: u16, defense: u16, attack: u16, max_damage: u16,
    ): u64 {
        (hp as u64) * W_HP
            + (armor as u64) * W_ARMOR
            + (defense as u64) * W_DEFENSE
            + (attack as u64) * W_ATTACK
            + (max_damage as u64) * W_MAX_DAMAGE
            + (strength as u64) * W_STRENGTH
            + (dexterity as u64) * W_DEXTERITY
            + (endurance as u64) * W_ENDURANCE
    }

    /// v5.3 — Chance points (level-independent stats).
    public fun chance_points(
        intuition: u16, crit_chance: u16, crit_multiplier: u16,
        evasion: u16, anti_crit: u16, anti_evasion: u16,
    ): u64 {
        (intuition as u64) * 2
            + (crit_chance as u64)
            + (evasion as u64)
            + (anti_crit as u64)
            + (anti_evasion as u64)
            + (crit_multiplier as u64) / 10
    }

    public fun max_chance_points(): u64 { MAX_CHANCE_POINTS }

    /// v5.3 — Minimum level_req for weapons and shields.
    public fun min_hand_item_level(): u8 { MIN_HAND_ITEM_LEVEL }

    // ===== Mint (admin-gated) =====

    /// Mint a new item NFT. Admin-only — requires the AdminCap held by the server/treasury.
    /// Items mint to the sender (TREASURY) and are then transferred to players.
    /// Stat bonuses, level requirement, damage range, slot_type shape, and the
    /// v5.3 level-scaled power limits are all bounded. No rarity tiers.
    public fun mint_item_admin(
        _admin: &AdminCap,
        name: String,
        image_url: String,
        item_type: u8,
        class_req: u8,
        level_req: u8,
        slot_type: u8,
        strength_bonus: u16,
        dexterity_bonus: u16,
        intuition_bonus: u16,
        endurance_bonus: u16,
        hp_bonus: u16,
        armor_bonus: u16,
        defense_bonus: u16,
        attack_bonus: u16,
        crit_chance_bonus: u16,
        crit_multiplier_bonus: u16,
        evasion_bonus: u16,
        anti_crit_bonus: u16,
        anti_evasion_bonus: u16,
        min_damage: u16,
        max_damage: u16,
        ctx: &mut TxContext,
    ) {
        assert!(item_type >= WEAPON && item_type <= EARRINGS, EInvalidItemType);
        assert!(level_req >= 1, ELevelReqZero);
        assert!(level_req <= MAX_LEVEL_REQ, ELevelReqTooHigh);
        assert!(min_damage <= max_damage, EDamageRangeInvalid);

        // v5.3 — weapons + shields start at MIN_HAND_ITEM_LEVEL.
        if (item_type == WEAPON || item_type == SHIELD) {
            assert!(level_req >= MIN_HAND_ITEM_LEVEL, EHandItemLevelTooLow);
        };

        // v5.1 — slot_type shape per item_type
        if (item_type == WEAPON) {
            // Weapons are mainhand or two-handed; never offhand-only.
            assert!(slot_type == SLOT_MAINHAND || slot_type == SLOT_BOTH_HANDS, EWeaponSlotTypeInvalid);
        } else if (item_type == SHIELD) {
            // Shields are offhand only.
            assert!(slot_type == SLOT_OFFHAND, EInvalidSlotType);
        } else {
            // Helmet / chest / gloves / boots / belt / ring / necklace —
            // their slot is determined by item_type itself; slot_type is N/A
            // and must be 0 by convention.
            assert!(slot_type == SLOT_MAINHAND, EInvalidSlotType);
        };

        // Bound every stat-bonus field individually (defence-in-depth — the
        // power limits below are the tighter gate, but individual caps prevent
        // overflow on combat math intermediaries).
        assert!(strength_bonus        <= MAX_BONUS, EBonusTooHigh);
        assert!(dexterity_bonus       <= MAX_BONUS, EBonusTooHigh);
        assert!(intuition_bonus       <= MAX_BONUS, EBonusTooHigh);
        assert!(endurance_bonus       <= MAX_BONUS, EBonusTooHigh);
        assert!(hp_bonus              <= MAX_BONUS, EBonusTooHigh);
        assert!(armor_bonus           <= MAX_BONUS, EBonusTooHigh);
        assert!(defense_bonus         <= MAX_BONUS, EBonusTooHigh);
        assert!(attack_bonus          <= MAX_BONUS, EBonusTooHigh);
        assert!(crit_chance_bonus     <= MAX_BONUS, EBonusTooHigh);
        assert!(crit_multiplier_bonus <= MAX_BONUS, EBonusTooHigh);
        assert!(evasion_bonus         <= MAX_BONUS, EBonusTooHigh);
        assert!(anti_crit_bonus       <= MAX_BONUS, EBonusTooHigh);
        assert!(anti_evasion_bonus    <= MAX_BONUS, EBonusTooHigh);
        assert!(max_damage            <= MAX_BONUS, EBonusTooHigh);

        // v5.3 — level-scaled power limits (replace rarity budgets).
        let power = flat_power(
            strength_bonus, dexterity_bonus, endurance_bonus, hp_bonus,
            armor_bonus, defense_bonus, attack_bonus, max_damage,
        );
        assert!(power <= max_flat_power(level_req), EPowerBudgetExceeded);
        let chance = chance_points(
            intuition_bonus, crit_chance_bonus, crit_multiplier_bonus,
            evasion_bonus, anti_crit_bonus, anti_evasion_bonus,
        );
        assert!(chance <= MAX_CHANCE_POINTS, EChancePointsExceeded);

        let item = Item {
            id: object::new(ctx),
            name,
            image_url,
            item_type,
            class_req,
            level_req,
            slot_type,
            strength_bonus,
            dexterity_bonus,
            intuition_bonus,
            endurance_bonus,
            hp_bonus,
            armor_bonus,
            defense_bonus,
            attack_bonus,
            crit_chance_bonus,
            crit_multiplier_bonus,
            evasion_bonus,
            anti_crit_bonus,
            anti_evasion_bonus,
            min_damage,
            max_damage,
        };

        let item_id = object::id(&item);
        let owner = tx_context::sender(ctx);

        event::emit(ItemMinted {
            item_id,
            name: item.name,
            item_type,
            level_req,
            slot_type,
            owner,
        });

        transfer::public_transfer(item, owner);
    }

    // ===== Read-only accessors =====

    public fun item_type(item: &Item): u8 { item.item_type }
    public fun class_req(item: &Item): u8 { item.class_req }
    public fun level_req(item: &Item): u8 { item.level_req }
    /// v5.1 — slot_type accessor. equipment.move consumes this; frontend reads
    /// it directly when building the equipment picker.
    public fun slot_type(item: &Item): u8 { item.slot_type }
    public fun name(item: &Item): String { item.name }
    public fun image_url(item: &Item): String { item.image_url }
    public fun strength_bonus(item: &Item): u16 { item.strength_bonus }
    public fun dexterity_bonus(item: &Item): u16 { item.dexterity_bonus }
    public fun intuition_bonus(item: &Item): u16 { item.intuition_bonus }
    public fun endurance_bonus(item: &Item): u16 { item.endurance_bonus }
    public fun hp_bonus(item: &Item): u16 { item.hp_bonus }
    public fun armor_bonus(item: &Item): u16 { item.armor_bonus }
    public fun defense_bonus(item: &Item): u16 { item.defense_bonus }
    public fun attack_bonus(item: &Item): u16 { item.attack_bonus }
    public fun crit_chance_bonus(item: &Item): u16 { item.crit_chance_bonus }
    public fun crit_multiplier_bonus(item: &Item): u16 { item.crit_multiplier_bonus }
    public fun evasion_bonus(item: &Item): u16 { item.evasion_bonus }
    public fun anti_crit_bonus(item: &Item): u16 { item.anti_crit_bonus }
    public fun anti_evasion_bonus(item: &Item): u16 { item.anti_evasion_bonus }
    public fun min_damage(item: &Item): u16 { item.min_damage }
    public fun max_damage(item: &Item): u16 { item.max_damage }

    // Item type constant accessors (consumed by equipment module + clients)
    public fun weapon_type(): u8 { WEAPON }
    public fun shield_type(): u8 { SHIELD }
    public fun helmet_type(): u8 { HELMET }
    public fun chest_type(): u8 { CHEST }
    public fun gloves_type(): u8 { GLOVES }
    public fun boots_type(): u8 { BOOTS }
    public fun belt_type(): u8 { BELT }
    public fun ring_type(): u8 { RING }
    public fun necklace_type(): u8 { NECKLACE }
    /// v5.1 (2026-05-28 PM) — accessors for the 2 new wearable types.
    /// (ring_3 reuses RING=8; no new type needed.)
    public fun pants_type(): u8 { PANTS }
    public fun bracelets_type(): u8 { BRACELETS }
    public fun earrings_type(): u8 { EARRINGS }

    // v5.1 — slot_type constant accessors
    public fun slot_mainhand(): u8 { SLOT_MAINHAND }
    public fun slot_offhand(): u8 { SLOT_OFFHAND }
    public fun slot_both_hands(): u8 { SLOT_BOTH_HANDS }
}
