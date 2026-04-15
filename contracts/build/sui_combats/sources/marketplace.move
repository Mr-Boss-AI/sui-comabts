module sui_combats::marketplace {
    use sui::object::{Self, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::kiosk::{Self, Kiosk, KioskOwnerCap};
    use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap};
    use sui::package::Publisher;

    use sui_combats::item::Item;

    // ===== Error constants =====
    const EInvalidPrice: u64 = 0;

    // ===== Royalty config =====
    // 2.5% = 250 basis points
    const ROYALTY_BPS: u16 = 250;
    const BPS_BASE: u16 = 10000;

    // ===== Events =====
    public struct KioskCreated has copy, drop {
        kiosk_id: ID,
        owner: address,
    }

    public struct ItemListed has copy, drop {
        kiosk_id: ID,
        item_id: ID,
        price: u64,
        seller: address,
    }

    public struct ItemDelisted has copy, drop {
        kiosk_id: ID,
        item_id: ID,
        seller: address,
    }

    public struct ItemPurchased has copy, drop {
        kiosk_id: ID,
        item_id: ID,
        buyer: address,
        price: u64,
    }

    public struct PolicyCreated has copy, drop {
        policy_id: ID,
    }

    // ===== Public functions =====

    /// Create a new Kiosk for a player. The Kiosk is shared; the KioskOwnerCap is transferred to the sender.
    public entry fun create_player_kiosk(ctx: &mut TxContext) {
        let (kiosk, cap) = kiosk::new(ctx);
        let kiosk_id = object::id(&kiosk);
        let owner = tx_context::sender(ctx);

        event::emit(KioskCreated {
            kiosk_id,
            owner,
        });

        transfer::public_share_object(kiosk);
        transfer::public_transfer(cap, owner);
    }

    /// List an item in the player's kiosk at the given price (in MIST).
    public entry fun list_item(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        item: Item,
        price: u64,
        ctx: &mut TxContext,
    ) {
        assert!(price > 0, EInvalidPrice);

        let item_id = object::id(&item);
        let kiosk_id = object::id(kiosk);
        let seller = tx_context::sender(ctx);

        kiosk::place(kiosk, cap, item);
        kiosk::list<Item>(kiosk, cap, item_id, price);

        event::emit(ItemListed {
            kiosk_id,
            item_id,
            price,
            seller,
        });
    }

    /// Delist an item from the kiosk (returns it to the kiosk as unlisted).
    public entry fun delist_item(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        item_id: ID,
        ctx: &mut TxContext,
    ) {
        let kiosk_id = object::id(kiosk);
        let seller = tx_context::sender(ctx);

        kiosk::delist<Item>(kiosk, cap, item_id);

        event::emit(ItemDelisted {
            kiosk_id,
            item_id,
            seller,
        });
    }

    /// Purchase an item from a kiosk. Requires a TransferPolicy<Item>.
    public entry fun buy_item(
        kiosk: &mut Kiosk,
        item_id: ID,
        payment: Coin<SUI>,
        policy: &mut TransferPolicy<Item>,
        ctx: &mut TxContext,
    ) {
        let kiosk_id = object::id(kiosk);
        let buyer = tx_context::sender(ctx);
        let price = coin::value(&payment);

        let (item, request) = kiosk::purchase<Item>(kiosk, item_id, payment);

        // Confirm the transfer request against the policy
        transfer_policy::confirm_request(policy, request);

        event::emit(ItemPurchased {
            kiosk_id,
            item_id,
            buyer,
            price,
        });

        transfer::public_transfer(item, buyer);
    }

    /// Setup a TransferPolicy for Item type with the Publisher.
    /// This should be called once after package deployment by the publisher holder.
    public entry fun setup_transfer_policy(
        publisher: &Publisher,
        ctx: &mut TxContext,
    ) {
        let (policy, cap) = transfer_policy::new<Item>(publisher, ctx);
        let policy_id = object::id(&policy);

        event::emit(PolicyCreated {
            policy_id,
        });

        let owner = tx_context::sender(ctx);
        transfer::public_share_object(policy);
        transfer::public_transfer(cap, owner);
    }
}
