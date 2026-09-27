/// v5.3 — Package version gate for every shared object.
///
/// Sui keeps old package versions callable forever after an upgrade. Every
/// shared object carries `version`, and every function that touches one
/// asserts it matches VERSION. After an upgrade that bumps VERSION, objects
/// are migrated (permissionless `migrate_*`, which can only move a version
/// UP) and the old package's code aborts on them — so a bug fixed in an
/// upgrade can't be exploited through the old code.
module sui_combats::version {
    const VERSION: u64 = 1;

    /// Object belongs to a different package version (refresh / migrate).
    const EWrongVersion: u64 = 0;
    /// migrate_* called on an object that is already current.
    const EAlreadyCurrent: u64 = 1;

    public fun current(): u64 { VERSION }

    public(package) fun check(v: u64) { assert!(v == VERSION, EWrongVersion); }

    /// New version for a migrating object; only ever moves up.
    public(package) fun next(v: u64): u64 { assert!(v < VERSION, EAlreadyCurrent); VERSION }
}
