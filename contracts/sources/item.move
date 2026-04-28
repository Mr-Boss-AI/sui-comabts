#[allow(lint(self_transfer))]
module sui_combats::item {
    use sui::event;
    use sui::package;
    use std::string::String;

    use sui_combats::character::AdminCap;

    // ===== Error constants =====
    const EInvalidItemType: u64 = 0;
    const EInvalidRarity: u64 = 1;
    const EBonusTooHigh: u64 = 2;
    const ELevelReqTooHigh: u64 = 3;
    const EDamageRangeInvalid: u64 = 4;

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

    // ===== Rarity constants =====
    const COMMON: u8 = 1;
    const LEGENDARY: u8 = 5;

    // ===== Hardening caps =====
    /// Each stat-bonus field on a minted item may not exceed this value.
    /// Combat math uses u16/u32 intermediaries; 1000 leaves headroom for
    /// stacking up to 10 items (10 * 1000 = 10_000) without overflow risk.
    const MAX_BONUS: u16 = 1000;

    /// Items above MAX_LEVEL_REQ would be permanently unusable (max char level = 20).
    const MAX_LEVEL_REQ: u8 = 20;

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
        rarity: u8,
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
        rarity: u8,
        owner: address,
    }

    // ===== Init: claim Publisher (used later by marketplace::setup_transfer_policy) =====
    fun init(otw: ITEM, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);
        transfer::public_transfer(publisher, tx_context::sender(ctx));
    }

    // ===== Mint (admin-gated) =====

    /// Mint a new item NFT. Admin-only — requires the AdminCap held by the server/treasury.
    /// Items mint to the sender (TREASURY) and are then transferred to players.
    /// Stat bonuses, level requirement, and damage range are all bounded.
    public fun mint_item_admin(
        _admin: &AdminCap,
        name: String,
        image_url: String,
        item_type: u8,
        class_req: u8,
        level_req: u8,
        rarity: u8,
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
        assert!(item_type >= WEAPON && item_type <= NECKLACE, EInvalidItemType);
        assert!(rarity >= COMMON && rarity <= LEGENDARY, EInvalidRarity);
        assert!(level_req <= MAX_LEVEL_REQ, ELevelReqTooHigh);
        assert!(min_damage <= max_damage, EDamageRangeInvalid);

        // Bound every stat-bonus field
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

        let item = Item {
            id: object::new(ctx),
            name,
            image_url,
            item_type,
            class_req,
            level_req,
            rarity,
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
            rarity,
            owner,
        });

        transfer::public_transfer(item, owner);
    }

    // ===== Read-only accessors =====

    public fun item_type(item: &Item): u8 { item.item_type }
    public fun class_req(item: &Item): u8 { item.class_req }
    public fun level_req(item: &Item): u8 { item.level_req }
    public fun rarity(item: &Item): u8 { item.rarity }
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
}
