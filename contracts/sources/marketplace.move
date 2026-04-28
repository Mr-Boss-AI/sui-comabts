#[allow(lint(self_transfer, share_owned))]
module sui_combats::marketplace {
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::kiosk::{Self, Kiosk, KioskOwnerCap};
    use sui::transfer_policy::{Self, TransferPolicy};
    use sui::package::Publisher;

    use sui_combats::item::Item;
    use sui_combats::royalty_rule;

    // ===== Error constants =====
    const EInvalidPrice: u64 = 0;
    const EInsufficientFee: u64 = 1;

    // ===== Royalty: 2.5% of sale price, with a MIST floor =====
    const ROYALTY_BPS: u16 = 250;
    /// Floor prevents rounding-to-zero on tiny sales. 0.000001 SUI = 1000 MIST.
    const ROYALTY_MIN_MIST: u64 = 1_000;

    // ===== Listing fee: flat 0.01 SUI charged on every list, not refunded =====
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
        royalty_paid: u64,
    }

    public struct PolicyCreated has copy, drop {
        policy_id: ID,
    }

    // ===== Public functions =====

    /// Create a Kiosk owned by the sender. Kiosk is shared, OwnerCap goes to sender.
    public fun create_player_kiosk(ctx: &mut TxContext) {
        let (kiosk, cap) = kiosk::new(ctx);
        let kiosk_id = object::id(&kiosk);
        let owner = tx_context::sender(ctx);

        event::emit(KioskCreated { kiosk_id, owner });

        transfer::public_share_object(kiosk);
        transfer::public_transfer(cap, owner);
    }

    /// List an Item in the player's Kiosk at `price` MIST. Caller pays a flat
    /// `LISTING_FEE_MIST` listing fee, routed to `treasury`. Excess in `fee`
    /// is refunded to the sender.
    public fun list_item(
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

        // Take exactly the listing fee, refund any excess
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

        event::emit(ItemListed { kiosk_id, item_id, price, seller: sender });
    }

    /// Delist an item from a kiosk. Item stays in the kiosk as unlisted.
    /// Listing fee is NOT refunded.
    public fun delist_item(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        item_id: ID,
        ctx: &TxContext,
    ) {
        let kiosk_id = object::id(kiosk);
        let seller = tx_context::sender(ctx);

        kiosk::delist<Item>(kiosk, cap, item_id);

        event::emit(ItemDelisted { kiosk_id, item_id, seller });
    }

    /// Purchase a listed item.
    ///   `payment`         — exact list price.
    ///   `royalty_payment` — exact royalty per the policy (use `royalty_rule::amount`
    ///                       on the client to pre-compute).
    public fun buy_item(
        kiosk: &mut Kiosk,
        item_id: ID,
        payment: Coin<SUI>,
        royalty_payment: Coin<SUI>,
        policy: &mut TransferPolicy<Item>,
        ctx: &mut TxContext,
    ) {
        let kiosk_id = object::id(kiosk);
        let buyer = tx_context::sender(ctx);
        let price = coin::value(&payment);
        let royalty_paid = coin::value(&royalty_payment);

        let (item, mut request) = kiosk::purchase<Item>(kiosk, item_id, payment);

        // Settle the royalty rule on the request
        royalty_rule::pay(policy, &mut request, royalty_payment);

        // All rules satisfied — confirm the request against the policy
        transfer_policy::confirm_request(policy, request);

        event::emit(ItemPurchased {
            kiosk_id,
            item_id,
            buyer,
            price,
            royalty_paid,
        });

        transfer::public_transfer(item, buyer);
    }

    /// Create the TransferPolicy for `Item` and attach the 2.5% royalty rule.
    /// Call once after package publish from the Publisher holder.
    public fun setup_transfer_policy(
        publisher: &Publisher,
        ctx: &mut TxContext,
    ) {
        let (mut policy, cap) = transfer_policy::new<Item>(publisher, ctx);
        let policy_id = object::id(&policy);

        // Wire the 2.5% royalty rule
        royalty_rule::add(&mut policy, &cap, ROYALTY_BPS, ROYALTY_MIN_MIST);

        event::emit(PolicyCreated { policy_id });

        let owner = tx_context::sender(ctx);
        transfer::public_share_object(policy);
        transfer::public_transfer(cap, owner);
    }
}
