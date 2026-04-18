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
    const EInsufficientFee: u64 = 1;
    const EDeprecated: u64 = 2;

    // ===== Royalty config =====
    // 2.5% = 250 basis points
    const ROYALTY_BPS: u16 = 250;
    const BPS_BASE: u16 = 10000;

    // ===== Listing fee =====
    // 0.01 SUI = 10,000,000 MIST. Charged once on list_item_with_fee; not refunded on delist.
    const LISTING_FEE_MIST: u64 = 10_000_000;

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

    /// DEPRECATED v1 list (no listing fee). Use `list_item_with_fee`.
    public entry fun list_item(
        _kiosk: &mut Kiosk,
        _cap: &KioskOwnerCap,
        _item: Item,
        _price: u64,
        _ctx: &mut TxContext,
    ) {
        abort EDeprecated
    }

    /// List an item in the player's kiosk at the given price (in MIST).
    /// Requires a `fee` coin of at least `LISTING_FEE_MIST` (0.01 SUI). Exactly
    /// `LISTING_FEE_MIST` is sent to `treasury`; any excess is refunded to sender.
    /// The `treasury` address is passed by the caller (not hardcoded) so mainnet
    /// deployment can target a different wallet without a contract upgrade.
    public entry fun list_item_with_fee(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        item: Item,
        price: u64,
        mut fee: Coin<SUI>,
        treasury: address,
        ctx: &mut TxContext,
    ) {
        assert!(price > 0, EInvalidPrice);
        assert!(coin::value(&fee) >= LISTING_FEE_MIST, EInsufficientFee);

        // Take exactly the listing fee; refund any excess to the seller.
        let fee_coin = coin::split(&mut fee, LISTING_FEE_MIST, ctx);
        transfer::public_transfer(fee_coin, treasury);

        let sender = tx_context::sender(ctx);
        if (coin::value(&fee) > 0) {
            transfer::public_transfer(fee, sender);
        } else {
            coin::destroy_zero(fee);
        };

        let item_id = object::id(&item);
        let kiosk_id = object::id(kiosk);

        kiosk::place(kiosk, cap, item);
        kiosk::list<Item>(kiosk, cap, item_id, price);

        event::emit(ItemListed {
            kiosk_id,
            item_id,
            price,
            seller: sender,
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
