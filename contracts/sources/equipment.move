#[allow(lint(self_transfer))]
module sui_combats::equipment {
    use sui::event;
    use sui::clock::Clock;
    use sui::dynamic_object_field as dof;
    use std::string::{Self, String};

    use sui_combats::character::{Self, Character};
    use sui_combats::item::{Self, Item};

    // ===== Error constants =====
    const EWrongItemType: u64 = 0;
    const ESlotOccupied: u64 = 1;
    const ESlotEmpty: u64 = 2;
    const ELevelTooLow: u64 = 3;
    const ENotOwner: u64 = 4;
    const EFightLocked: u64 = 5;

    // ===== Events =====
    public struct ItemEquipped has copy, drop {
        character_id: ID,
        item_id: ID,
        slot: String,
    }

    public struct ItemUnequipped has copy, drop {
        character_id: ID,
        item_id: ID,
        slot: String,
    }

    public struct LoadoutSaved has copy, drop {
        character_id: ID,
        owner: address,
        version: u64,
    }

    // ===========================================================================
    //  EQUIP — owner + fight-lock + type/level + slot-empty (DOF presence) checks
    // ===========================================================================

    public fun equip_weapon(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::weapon_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"weapon");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_offhand(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        // Offhand accepts SHIELD or a second WEAPON (dual-wield)
        let it = item::item_type(&item);
        assert!(it == item::shield_type() || it == item::weapon_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"offhand");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_helmet(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::helmet_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"helmet");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_chest(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::chest_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"chest");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_gloves(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::gloves_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"gloves");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_boots(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::boots_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"boots");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_belt(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::belt_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"belt");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_ring_1(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::ring_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"ring_1");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_ring_2(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::ring_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"ring_2");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    public fun equip_necklace(
        character: &mut Character,
        item: Item,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);
        assert!(item::item_type(&item) == item::necklace_type(), EWrongItemType);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let slot = string::utf8(b"necklace");
        assert!(!dof::exists_<String>(character::uid(character), slot), ESlotOccupied);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        dof::add(character::uid_mut(character), slot, item);

        event::emit(ItemEquipped { character_id, item_id, slot });
    }

    // ===========================================================================
    //  UNEQUIP — owner + fight-lock + slot-filled (DOF presence) checks
    // ===========================================================================

    public fun unequip_weapon(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"weapon");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_offhand(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"offhand");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_helmet(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"helmet");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_chest(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"chest");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_gloves(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"gloves");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_boots(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"boots");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_belt(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"belt");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_ring_1(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"ring_1");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_ring_2(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"ring_2");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public fun unequip_necklace(
        character: &mut Character,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
        assert!(!character::is_fight_locked(character, clock), EFightLocked);

        let slot = string::utf8(b"necklace");
        assert!(dof::exists_<String>(character::uid(character), slot), ESlotEmpty);

        let character_id = object::id(character);
        let item: Item = dof::remove(character::uid_mut(character), slot);
        let item_id = object::id(&item);

        event::emit(ItemUnequipped { character_id, item_id, slot });
        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    // ===========================================================================
    //  SAVE LOADOUT — final command in a save PTB. Bumps loadout_version.
    //  Owner-only. No fight-lock check (the equip/unequip primitives in the
    //  same PTB enforce that; if locked, the whole PTB rolls back atomically).
    // ===========================================================================

    public fun save_loadout(
        character: &mut Character,
        ctx: &TxContext,
    ) {
        assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);

        let owner = character::owner(character);
        let character_id = object::id(character);
        let new_version = character::bump_loadout_version(character);

        event::emit(LoadoutSaved {
            character_id,
            owner,
            version: new_version,
        });
    }
}
