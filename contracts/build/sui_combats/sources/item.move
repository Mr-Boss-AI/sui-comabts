module sui_combats::item {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::package;
    use std::string::String;

    // ===== Error constants =====
    const EInvalidItemType: u64 = 0;
    const EInvalidRarity: u64 = 1;

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
    const UNCOMMON: u8 = 2;
    const RARE: u8 = 3;
    const EPIC: u8 = 4;
    const LEGENDARY: u8 = 5;

    // ===== One-time witness for Publisher =====
    public struct ITEM has drop {}

    // ===== Item struct =====
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
        // Weapon-specific fields
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

    // ===== Init: claim Publisher for transfer policy =====
    fun init(otw: ITEM, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);
        transfer::public_transfer(publisher, tx_context::sender(ctx));
    }

    // ===== Public functions =====

    /// Mint a new item NFT. Items are tradeable (have `store`).
    public entry fun mint_item(
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

    // ===== Accessor functions =====

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

    // Item type constant accessors (for external modules)
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
