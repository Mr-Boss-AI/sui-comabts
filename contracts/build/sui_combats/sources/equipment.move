module sui_combats::equipment {
    use sui::object::{Self, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::dynamic_object_field as dof;
    use std::option;
    use std::string::{Self, String};

    use sui_combats::character::{Self, Character};
    use sui_combats::item::{Self, Item};

    // ===== Error constants =====
    const EWrongItemType: u64 = 0;
    const ESlotOccupied: u64 = 1;
    const ESlotEmpty: u64 = 2;
    const ELevelTooLow: u64 = 3;

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

    // ===== Equip functions =====

    public entry fun equip_weapon(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::weapon_type(), EWrongItemType);
        assert!(option::is_none(&character::weapon(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"weapon");

        dof::add(character::uid_mut(character), key, item);
        character::set_weapon(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"weapon"),
        });
    }

    public entry fun equip_offhand(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::shield_type(), EWrongItemType);
        assert!(option::is_none(&character::offhand(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"offhand");

        dof::add(character::uid_mut(character), key, item);
        character::set_offhand(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"offhand"),
        });
    }

    public entry fun equip_helmet(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::helmet_type(), EWrongItemType);
        assert!(option::is_none(&character::helmet(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"helmet");

        dof::add(character::uid_mut(character), key, item);
        character::set_helmet(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"helmet"),
        });
    }

    public entry fun equip_chest(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::chest_type(), EWrongItemType);
        assert!(option::is_none(&character::chest(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"chest");

        dof::add(character::uid_mut(character), key, item);
        character::set_chest(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"chest"),
        });
    }

    public entry fun equip_gloves(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::gloves_type(), EWrongItemType);
        assert!(option::is_none(&character::gloves(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"gloves");

        dof::add(character::uid_mut(character), key, item);
        character::set_gloves(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"gloves"),
        });
    }

    public entry fun equip_boots(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::boots_type(), EWrongItemType);
        assert!(option::is_none(&character::boots(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"boots");

        dof::add(character::uid_mut(character), key, item);
        character::set_boots(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"boots"),
        });
    }

    public entry fun equip_belt(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::belt_type(), EWrongItemType);
        assert!(option::is_none(&character::belt(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"belt");

        dof::add(character::uid_mut(character), key, item);
        character::set_belt(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"belt"),
        });
    }

    public entry fun equip_ring_1(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::ring_type(), EWrongItemType);
        assert!(option::is_none(&character::ring_1(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"ring_1");

        dof::add(character::uid_mut(character), key, item);
        character::set_ring_1(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"ring_1"),
        });
    }

    public entry fun equip_ring_2(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::ring_type(), EWrongItemType);
        assert!(option::is_none(&character::ring_2(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"ring_2");

        dof::add(character::uid_mut(character), key, item);
        character::set_ring_2(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"ring_2"),
        });
    }

    public entry fun equip_necklace(character: &mut Character, item: Item) {
        assert!(item::item_type(&item) == item::necklace_type(), EWrongItemType);
        assert!(option::is_none(&character::necklace(character)), ESlotOccupied);
        assert!(item::level_req(&item) <= character::level(character), ELevelTooLow);

        let item_id = object::id(&item);
        let character_id = object::id(character);
        let key = string::utf8(b"necklace");

        dof::add(character::uid_mut(character), key, item);
        character::set_necklace(character, option::some(item_id));

        event::emit(ItemEquipped {
            character_id,
            item_id,
            slot: string::utf8(b"necklace"),
        });
    }

    // ===== Unequip functions =====

    public entry fun unequip_weapon(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::weapon(character)), ESlotEmpty);

        let key = string::utf8(b"weapon");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_weapon(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"weapon"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_offhand(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::offhand(character)), ESlotEmpty);

        let key = string::utf8(b"offhand");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_offhand(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"offhand"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_helmet(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::helmet(character)), ESlotEmpty);

        let key = string::utf8(b"helmet");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_helmet(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"helmet"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_chest(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::chest(character)), ESlotEmpty);

        let key = string::utf8(b"chest");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_chest(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"chest"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_gloves(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::gloves(character)), ESlotEmpty);

        let key = string::utf8(b"gloves");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_gloves(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"gloves"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_boots(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::boots(character)), ESlotEmpty);

        let key = string::utf8(b"boots");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_boots(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"boots"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_belt(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::belt(character)), ESlotEmpty);

        let key = string::utf8(b"belt");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_belt(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"belt"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_ring_1(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::ring_1(character)), ESlotEmpty);

        let key = string::utf8(b"ring_1");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_ring_1(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"ring_1"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_ring_2(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::ring_2(character)), ESlotEmpty);

        let key = string::utf8(b"ring_2");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_ring_2(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"ring_2"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }

    public entry fun unequip_necklace(character: &mut Character, ctx: &mut TxContext) {
        assert!(option::is_some(&character::necklace(character)), ESlotEmpty);

        let key = string::utf8(b"necklace");
        let item: Item = dof::remove(character::uid_mut(character), key);
        let item_id = object::id(&item);
        let character_id = object::id(character);

        character::set_necklace(character, option::none());

        event::emit(ItemUnequipped {
            character_id,
            item_id,
            slot: string::utf8(b"necklace"),
        });

        transfer::public_transfer(item, tx_context::sender(ctx));
    }
}
