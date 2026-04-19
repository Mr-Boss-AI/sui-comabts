# Loadout-Save UX Design

> **Status:** Draft for review. Branch: `feature/loadout-save`. Base commit: `08ff991`.
> **Goal:** Replace per-item "click → wallet popup" with classic-game "fiddle → Save Loadout → one wallet popup."

---

## Why we're considering this

Phase 0.5 shipped per-item equip/unequip. Every slot change = one wallet popup. After live testing today, the ergonomics are rough:

- Swapping 4 pieces of gear = 4 wallet popups, 4 confirmations, 4 RPC roundtrips
- Players want to "try on" a setup without committing — currently impossible without wallet noise
- 0.005 SUI per equip × 10 slots = real gas waste during experimentation

The proposed model matches what RPG players expect: **manipulate locally, commit explicitly.** Inventory screens in Diablo / WoW / Path of Exile / classic JRPGs all work this way.

---

## Decision points to resolve in review

These are the spots where I have a recommendation but the trade-off is real and you may prefer the other side. Marked with **DECIDE**.

| # | Question | Recommendation | Alternative |
|---|---|---|---|
| **D1** | New `save_loadout` Move entry fn, or a frontend-built PTB of existing `equip_*_v2` / `unequip_*_v2` calls? | **PTB-of-primitives** | New entry fn |
| **D2** | Add a `loadout_version: u64` counter as a DOF on Character? | **Yes, optional last command in the PTB** | Skip — counter not needed |
| **D3** | Server reads chain DOFs at fight start (anti-cheat) or trusts frontend's onChainEquipment payload? | **Read DOFs at fight start** | Trust frontend (simpler, less secure) |
| **D4** | Fight-with-dirty-pending behavior | **Combat uses last saved; dirty pending shown but inactive (per your spec)** | Auto-save before fight (extra wallet popup) |
| **D5** | Keep existing `equip_*_v2` / `unequip_*_v2` entry fns post-loadout? | **Yes, keep as primitives** | Deprecate them |

---

## D1 — New entry fn vs PTB of primitives

### Option A: New `save_loadout` entry function

```move
public entry fun save_loadout(
    character: &mut Character,
    weapon_in:    vector<Item>,    // 0 or 1 items
    offhand_in:   vector<Item>,
    helmet_in:    vector<Item>,
    chest_in:     vector<Item>,
    gloves_in:    vector<Item>,
    boots_in:     vector<Item>,
    belt_in:      vector<Item>,
    ring_1_in:    vector<Item>,
    ring_2_in:    vector<Item>,
    necklace_in:  vector<Item>,
    unequip_mask: u16,    // bitmask: bit i = unequip slot i (returns to sender)
    clock: &Clock,
    ctx: &mut TxContext,
)
```

- **Pros:** owner check + fight-lock check fire **once**, not 20 times → ~80% gas savings on a full-loadout swap. Clean atomic semantics. One Move call.
- **Cons:** `Move` doesn't have native `Option<Item>` parameters; must use `vector<Item>` (length 0 or 1) per slot — verbose, fragile. Adds new contract surface to test/audit. Requires another contract upgrade.

### Option B: PTB-of-primitives (recommended)

Frontend builds a single PTB containing 1-20 commands using existing v2 primitives:

```typescript
// One PTB:
//   unequip_weapon_v2(char, clock)
//   equip_weapon_v2(char, newWeapon, clock)
//   unequip_chest_v2(char, clock)
//   equip_chest_v2(char, newChest, clock)
//   ... (only for slots that changed)
```

- **Pros:** Zero contract changes. Reuses already-tested v2 functions. Sui PTBs are atomic at the chain level — entire PTB commits or nothing does. Same UX guarantee (one wallet popup) as Option A.
- **Cons:** Each command re-checks owner + fight-lock → ~2-3× gas vs Option A. For a 10-slot full swap: ~0.1 SUI vs ~0.02 SUI. For typical 2-3 slot swaps: ~0.02-0.03 SUI vs ~0.01 SUI.

### Why I lean Option B

- **No contract upgrade needed** — we just shipped Phase 0.5 to chain. Doing another upgrade right now means more bytecode bloat at the upgraded package, more deprecation patterns, more risk.
- **Gas overhead is acceptable on testnet** and even on mainnet (0.1 SUI ≈ a few cents at typical Sui prices).
- **Contract surface area stays small** — fewer functions to audit before mainnet.
- If the gas cost ever becomes a real concern, we can add Option A as a *gas-saving* optimization later without changing the UX.

---

## D2 — Loadout version counter

A `u64` counter stored as a DOF on Character (same pattern as `fight_lock_expires_at`). Keys we already use, both as DFs:

```
fight_lock_expires_at  →  u64 (added in Phase 0.5)
loadout_version        →  u64 (proposed)
```

New entry fn (admin-free, anyone-callable but owner-checked):
```move
public entry fun bump_loadout_version(character: &mut Character, ctx: &TxContext) {
    assert!(character::owner(character) == tx_context::sender(ctx), ENotOwner);
    let uid = &mut character.id;
    let next = if (df::exists_<vector<u8>>(uid, LOADOUT_VERSION_KEY)) {
        let cur: &mut u64 = df::borrow_mut(uid, LOADOUT_VERSION_KEY);
        *cur = *cur + 1;
        *cur
    } else {
        df::add(uid, LOADOUT_VERSION_KEY, 1u64);
        1
    };
    event::emit(LoadoutSaved { character_id: object::id(character), version: next });
}
```

The frontend tacks this on as the last command in the save PTB.

**Why bother with a counter?**
- **Anti-cheat (relevant if we go D3-strict):** server records the loadout version at fight start; if it changes mid-fight (impossible thanks to fight-lock, but defense-in-depth), server detects it
- **UX:** UI can show "Loadout v3" badge — nice for screenshots / pride
- **Indexing:** event-driven indexers can rebuild loadout history without scanning every equip event
- **Future loadout-templates feature:** named loadouts can reference a version number

**Why not bother:**
- Adds 1 Move call to every save PTB (~5M MIST extra gas)
- Counter doesn't enforce anything functionally — equip events already exist
- Adds one new contract function to maintain

**My pick:** Add it. The cost is negligible and it makes server reasoning easier. But happy to skip if you want minimal contract changes.

---

## D3 — Server: read DOFs vs trust frontend payload

Currently (post-Phase-0.5):
- Server snapshots `character.equipment` (in-memory) at fight start
- That equipment came from server-side `equip_item` WS handler (legacy NPC items) + `onChainEquipment` payload sent by frontend in `queue_fight`
- Frontend sends what its local Redux thinks is equipped — **this is trusted**

Loadout-save makes the trust gap visible:
- "Saved loadout" lives in chain DOFs on Character
- "Pending loadout" lives in frontend Redux
- If server keeps trusting the frontend payload, a malicious client can send "pending" as if it were saved → uses gear they haven't actually committed
- Worse: client could send made-up gear that isn't even in their wallet

### Option D3-strict: server reads chain DOFs at fight start

- Add `fetchEquippedFromDOFs(characterObjectId)` server-side helper (the deferred sui-read.ts work)
- At `createFight`, before snapshotting, fetch DOFs and overwrite `character.equipment` with chain truth
- Adds ~1 RPC roundtrip (~500ms) to fight start latency

### Option D3-trusting: keep current model

- Frontend sends `onChainEquipment` = its `committedEquipment` (NOT pending)
- Server applies as-is
- Anti-cheat depends on the client being honest

### Why I lean strict

- Today we have wager fights with real SUI. Cheating with un-committed gear = winning wagers you shouldn't = real money loss for the other player
- The 500ms latency hit is invisible against the wallet-popup time anyway
- Without it, the "loadout-save" mental model is a lie: "saved" doesn't actually mean anything to the server
- Mainnet absolutely needs this. Doing it now means the model is correct from day one

---

## D4 — Fight-with-dirty-pending behavior

You wrote: *"Between saves, combat uses last saved state."* Encoding that:

1. User has uncommitted pending changes
2. User clicks "Find Fight" / accepts a wager
3. Combat starts
4. Server reads chain DOFs (committed state) — this is what fights with
5. Frontend shows a one-time toast: *"Fighting with last saved loadout. Pending changes are not active until you Save."*
6. Save Loadout button is disabled during the fight (fight-lock from Phase 0.5 + UI gate)
7. After fight, save button re-enables; user can save or discard pending

**Alternative considered & rejected:** auto-save before fight. Forces a wallet popup right when player wants to fight, breaks the "no surprise popups" promise.

---

## D5 — Keep existing v2 primitives?

**Yes, keep them.** Reasons:

- They're the building blocks the loadout PTB calls
- Single-slot swap UX ("just change my weapon") is faster with one v2 call
- Future features (admin gear-grants, item drops on fight win that auto-equip, trial-of-the-gods loaner gear) need the primitives
- Removing them = another contract upgrade with another deprecation pass

The loadout-save flow is a *UX layer*, not a replacement.

---

## Frontend changes

### State model

```typescript
interface GameState {
  // ... existing fields ...
  
  // Two parallel slices for equipment:
  committedEquipment: EquipmentSlots;  // what's on chain (read at auth + after each save)
  pendingEquipment:   EquipmentSlots;  // what user is fiddling with (local only)
  
  // Removed: onChainEquipped (this WAS the pending view; replaced by pendingEquipment)
}
```

Derived helpers:
```typescript
const dirtySlots = computeDirtySlots(committed, pending);  // Set<slot>
const isDirty   = dirtySlots.size > 0;
```

### `useEquipmentActions` hook — new shape

Replaces today's `equip` / `unequip` (which sign immediately) with:

```typescript
{
  stageEquip(item, slot, currentSlotItem?): void,  // local-only, no wallet
  stageUnequip(slot): void,                        // local-only, no wallet
  stageDiscard(): void,                            // pending := committed
  saveLoadout(): Promise<boolean>,                 // builds PTB, signs, on success: committed := pending
  signing: boolean,
  isDirty: boolean,
  dirtySlots: Set<keyof EquipmentSlots>,
}
```

### UI surfaces

| Component | Change |
|---|---|
| Character page doll slots | Show pending state (colored border on dirty slots: yellow tint = changed). Click flow is identical to today, but no wallet prompt. |
| Inventory tab | Item state badges become: `saved-equipped` (lock icon), `pending-equipped` (yellow dot), `available`, `listed`. Drag-to-equip stages a change. |
| New "Save Loadout" button | Top-right of Character page. States: hidden (not dirty), enabled (dirty + not signing + not in fight), disabled greyed (signing or in fight, with reason tooltip). |
| Optional "Discard" button | Visible when dirty. Resets pending → committed. |
| Toast on fight start with dirty pending | "Fighting with last saved loadout. Pending changes inactive until you Save." |

### PTB builder

New file `frontend/src/lib/loadout-tx.ts`:
```typescript
export function buildSaveLoadoutTx(
  characterObjectId: string,
  committed: EquipmentSlots,
  pending: EquipmentSlots,
  bumpVersion: boolean = true,
): Transaction {
  const tx = new Transaction();
  for (const slot of SLOT_ORDER) {
    const c = committed[slot]?.id ?? null;
    const p = pending[slot]?.id ?? null;
    if (c === p) continue;
    const chainSlot = toChainSlot(slot);
    if (c) {
      tx.moveCall({
        target: `${CALL_PACKAGE}::equipment::unequip_${chainSlot}_v2`,
        arguments: [tx.object(characterObjectId), tx.object(SUI_CLOCK)],
      });
    }
    if (p) {
      tx.moveCall({
        target: `${CALL_PACKAGE}::equipment::equip_${chainSlot}_v2`,
        arguments: [tx.object(characterObjectId), tx.object(p), tx.object(SUI_CLOCK)],
      });
    }
  }
  if (bumpVersion) {
    tx.moveCall({
      target: `${CALL_PACKAGE}::character::bump_loadout_version`,
      arguments: [tx.object(characterObjectId)],
    });
  }
  return tx;
}
```

---

## Server changes

### `sui-read.ts` (NEW) — DOF reader

Stand up the helper deferred from Phase 0.5:
```typescript
export async function fetchEquippedFromDOFs(characterObjectId: string): Promise<EquipmentSlots>
```

Reads each slot DOF via JSON-RPC, returns a hydrated EquipmentSlots map.

### `handler.ts::handleAuth` — call the reader

After loading the character and verifying ghost items, replace `character.equipment` with the chain-truth read.

### `fight-room.ts::createFight` — re-read at fight start

Before snapshotting equipment for combat math, re-read DOFs (in case anything changed between auth and fight start).

### `handler.ts::handleQueueFight` — drop the trust path

Remove the `onChainEquipment` merge. Frontend doesn't send it anymore (or server ignores it if sent for backwards compat).

### `handleEquipItem` / `handleUnequipItem` — keep the legacy server path

These continue to handle server-only items (NPC shop legacy). The on-chain item rejection added in Phase 0.5 stays.

### Summary of server work

| File | Change |
|---|---|
| `server/src/utils/sui-read.ts` | **NEW** — DOF equipment reader |
| `server/src/ws/handler.ts::handleAuth` | Hydrate `character.equipment` from DOFs |
| `server/src/ws/handler.ts::handleQueueFight` | Drop `onChainEquipment` payload merge |
| `server/src/ws/fight-room.ts::createFight` | Re-read DOFs before snapshot |

---

## Contract changes

| File | Change | Why |
|---|---|---|
| `contracts/sources/character.move` | Add `bump_loadout_version` entry fn + `LOADOUT_VERSION_KEY` constant + `LoadoutSaved` event | D2 if accepted |
| Tests in `contracts/tests/` | Add `loadout_version_starts_at_zero`, `bump_increments`, `bump_owner_check` | Coverage |

If D1 = Option B (PTB) and D2 = no version counter, **zero contract changes needed.** The whole feature ships in frontend + server only.

If D1 = Option B + D2 = yes (recommended), one tiny new function + one upgrade.

---

## Failure modes

### F1 — User sells/transfers an item that's in pending equip changes

**Scenario:** Pending state has Iron Longsword in weapon slot. Before saving, user transfers Iron Longsword out of wallet via Sui wallet UI.

**Outcome:** Save PTB includes `equip_weapon_v2(char, IronLongsword, clock)`. Sui PTB validation fails because IronLongsword isn't directly owned anymore. Whole PTB aborts atomically. Pending state in browser still claims Iron Longsword equipped — false.

**Mitigation:**
- Re-fetch `onChainItems` after a save failure → recompute valid pending state → drop missing items from pending → show toast: "Iron Longsword no longer in wallet, removed from pending."
- Defensive: on every render, filter pending against current `onChainItems` set; auto-strip stale entries with a one-time toast.

### F2 — Item listed on Kiosk while in pending changes

Same as F1 (item leaves wallet). Same mitigation.

### F3 — PTB exceeds gas budget

10 slots × 2 calls per slot = 20 commands max. At ~5M MIST per equip/unequip = 100M MIST total budget required. Default `--gas-budget 500000000` (0.5 SUI) covers this comfortably.

If we add `bump_loadout_version` (~3M MIST), total ~103M. Still fine.

**Mitigation:** Set `tx.setGasBudget(150_000_000)` explicitly in `buildSaveLoadoutTx` to absorb worst-case + 50% headroom. Warn user in UI if save would touch more than 8 slots ("Large loadout change — will use up to 0.15 SUI gas").

### F4 — Slot has same item committed and pending (no-op)

Skip in PTB. Already handled by `if (c === p) continue;` in the builder. Saves gas.

### F5 — Save during active fight

Fight-lock DF on Character makes every individual unequip/equip in the PTB abort with `EFightLocked`. PTB rolls back atomically. Frontend should pre-emptively disable Save button during fight (already part of the design).

If user somehow bypasses the UI gate, the chain rejects. Defense-in-depth holds.

### F6 — Two browser tabs both editing pending, both Save

Local state diverges between tabs. Both PTBs fire. Sui serializes them — both succeed if their effective changes don't conflict. Last-write-wins on chain. Acceptable; no hard guarantee needed (this is UI-level concern).

If we want stronger coordination: include `loadout_version` in the PTB and have `bump_loadout_version` assert the expected current version (CAS pattern). Out of scope unless we see real conflicts.

### F7 — `committed` state out of date with chain

User saves loadout in tab A. Tab B's `committed` is stale. User in Tab B builds a PTB based on stale committed → unequips items that are already unequipped → abort `ESlotEmpty`.

**Mitigation:** Refresh `committed` from chain on every Save attempt before building PTB. Also bump on the existing `BUMP_ONCHAIN_REFRESH` after auth.

### F8 — Pending equip into a slot that's already filled in committed

PTB correctly handles: unequip first, then equip. The builder above does this.

### F9 — User's wallet rejects the PTB signature

Catch in saveLoadout, show toast "Save cancelled in wallet." Pending state preserved (user can try again or discard).

### F10 — Network partition between sign and execute

`signAndExecuteTransaction` retries internally on transient failures. If permanent: catch, toast, preserve pending.

---

## Migration story

Existing on-chain equipped items become "loadout v0" automatically:
- Nothing on chain changes for existing characters
- At first auth after deploy, server reads DOFs → `committedEquipment = chainState`
- `pendingEquipment` initialized to deep-copy of committed → `isDirty = false`
- First save bumps `loadout_version` from absent (treated as 0) → 1

No data migration. Self-healing.

**One UX consideration:** after we deploy this, players who had Phase-0.5 single-equip workflow muscle memory will see their old "click to equip" trigger a *staged* change instead of an immediate wallet popup. We should:
- Show a one-time onboarding modal: *"Equipment now uses save-loadout flow. Stage your changes, then click Save Loadout to commit on-chain."*
- Server-side `migration_notice_v2_seen` flag in DB; cleared on view

---

## Testing plan

After implementation:

1. **Stage a single change, save** — one item changes, PTB has 2 commands (unequip + equip), succeeds, committed reflects new state, pending matches committed, isDirty = false
2. **Stage 5 changes, save** — full upper body swap, PTB has 10 commands, succeeds, all 5 slots reflect new state on chain via `suix_getDynamicFields`
3. **Stage change, then revert manually (back to committed), check isDirty = false** — diff detection works
4. **Stage changes, click Discard** — pending resets to committed, button hides
5. **Try Save during active fight** — button disabled, tooltip explains
6. **Try Save with one stale item (sell mid-edit)** — F1 path, graceful recovery, item dropped from pending
7. **Save loadout, refresh page** — chain DOFs persist, committed re-hydrates, no UI desync
8. **Two-tab save race** — both succeed, one's effects override (acceptable)
9. **Server-side fight uses chain DOFs, not frontend-sent equipment** — verify by manually editing the WS payload to lie; server should ignore and read chain
10. **`bump_loadout_version` (if D2 accepted)** — counter increments, event fires, owner check rejects non-owner

---

## Risk assessment — should we even do this?

| Risk | Severity | Mitigation |
|---|---|---|
| Touches the most-used UX flow | High blast radius | Branch experiment, full test suite before merge |
| Server change affects every fight (fight start latency) | Medium | The 500ms RPC fits within wallet-popup time; UX neutral |
| Two states (committed/pending) is genuinely more complex than one | Medium | Hide behind hook; UI surfaces stay simple |
| Gas overhead on PTB-of-primitives vs single fn | Low | Acceptable on testnet; revisit for mainnet |
| Loadout version counter is YAGNI today | Low | Skip if uncertain — easy to add later |
| Migration confuses existing users | Low | One-time onboarding modal |

**My honest read:** the UX win is real and matches player expectation. The implementation is moderate-complexity. The chief risk is server-side D3 (DOF read at fight start) — if we skip it, the loadout model is a UI fiction with no on-chain anti-cheat backing.

If you decide to proceed, the order I'd implement:
1. Server: stand up `sui-read.ts`, hydrate at auth + at fight start (D3-strict)
2. Frontend: add `committed`/`pending` state slices; wire `useEquipmentActions` to stage-only by default; build `saveLoadout()`
3. Contract: `bump_loadout_version` (D2 if accepted) + upgrade
4. Tests + onboarding modal

Estimated effort: ~1-2 dev sessions of similar scope to Phase 0.5.

---

## What I need from you

Concrete decisions:

- **D1**: PTB-of-primitives (recommended) or new `save_loadout` entry fn?
- **D2**: Add `bump_loadout_version` counter or skip?
- **D3**: Server reads DOFs at fight start (strict, recommended) or trust frontend?
- **D4**: Fight-with-dirty behavior — confirm "use last saved, show toast" matches your intent
- **D5**: Confirm we keep `equip_*_v2` / `unequip_*_v2` as primitives
- Any failure mode I haven't considered?
- Estimated effort feels right? If too big, what subset would you want as a v0?

Stopping here. No code written on this branch yet — only this design doc. Awaiting your sign-off (or course correction) before any implementation begins.
