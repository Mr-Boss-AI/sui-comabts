/// Minimal royalty enforcement rule for Sui Kiosk's TransferPolicy.
/// Models the canonical pattern from MystenLabs/apps `kiosk` extensions:
/// the rule is a zero-data witness, configured per-policy with a basis-point
/// rate and a MIST floor, and the buyer pays royalty as a separate Coin<SUI>
/// when completing a Kiosk purchase.
module sui_combats::royalty_rule {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

    // ===== Errors =====
    const EIncorrectAmount: u64 = 0;

    // ===== BPS denominator =====
    const BPS_BASE: u16 = 10_000;

    // ===== Witness for the rule (zero-data) =====
    public struct Rule has drop {}

    // ===== Per-policy config =====
    public struct Config has store, drop {
        amount_bp: u16,
        min_amount: u64,
    }

    /// Attach a royalty rule to `policy`. Royalty owed on each sale is
    /// `paid_price * amount_bp / 10_000`, never less than `min_amount` MIST.
    public fun add<T>(
        policy: &mut TransferPolicy<T>,
        cap: &TransferPolicyCap<T>,
        amount_bp: u16,
        min_amount: u64,
    ) {
        transfer_policy::add_rule(
            Rule {},
            policy,
            cap,
            Config { amount_bp, min_amount },
        );
    }

    /// Buyer pays royalty for an in-flight TransferRequest.
    /// `payment` MUST equal the computed required amount (use `amount()` to
    /// pre-compute client-side).
    public fun pay<T>(
        policy: &mut TransferPolicy<T>,
        request: &mut TransferRequest<T>,
        payment: Coin<SUI>,
    ) {
        let required = amount(policy, transfer_policy::paid(request));
        assert!(coin::value(&payment) == required, EIncorrectAmount);

        transfer_policy::add_to_balance(Rule {}, policy, payment);
        transfer_policy::add_receipt(Rule {}, request);
    }

    /// Pure helper: how much royalty is owed for a sale at `paid` MIST?
    public fun amount<T>(policy: &TransferPolicy<T>, paid: u64): u64 {
        let cfg: &Config = transfer_policy::get_rule(Rule {}, policy);
        let computed = (((paid as u128) * (cfg.amount_bp as u128)) / (BPS_BASE as u128)) as u64;
        if (computed < cfg.min_amount) cfg.min_amount else computed
    }
}
