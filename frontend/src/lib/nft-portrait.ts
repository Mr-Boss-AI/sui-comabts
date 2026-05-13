/**
 * NFT Portrait — pure helpers for the cosmetic character portrait
 * picker (Phase 2).
 *
 * The portrait is purely cosmetic — no on-chain tx, no wallet popup, no
 * stat impact. Selection persists in localStorage keyed by wallet
 * address so two wallets on the same browser get independent choices.
 *
 * Pure module — no React, no DOM, no I/O except localStorage (which is
 * dependency-injected for tests). Tested via `qa-nft-portrait-picker.ts`.
 */

export interface NftCandidate {
  /** Sui object id (`0x…`). Unique per NFT. */
  objectId: string;
  /** Best-effort display name (Display.name or extracted from json). */
  name: string;
  /** http(s) or ipfs URL — pre-resolved to http if possible. May be ''.
   *  Component falls back to the name on gunmetal if it fails to load. */
  imageUrl: string;
  /** Type tag like `0xabc::module::Type` — for collection hover. */
  typeTag: string;
}

/** Raw object shape from `suix_getOwnedObjects` / `listOwnedObjects`. */
export interface RawOwnedObject {
  objectId: string;
  type?: string | null;
  display?: { data?: Record<string, string | null> | null } | null;
  /** Some SDK shapes return Display under `data.display.data` instead of
   *  `display.data`. The filter tolerates both. */
  data?: {
    display?: { data?: Record<string, string | null> | null } | null;
    type?: string | null;
    objectId?: string | null;
    content?: { fields?: Record<string, unknown> | null } | null;
  } | null;
}

/* ───────────────────────────── extraction ──────────────────────────── */

/** Read a Display field (name / image_url / description / link …) tolerating
 *  the two SDK shapes (`obj.display.data.image_url` vs
 *  `obj.data.display.data.image_url`). Returns `null` when absent.
 *  Pure — does not normalise scheme. */
export function getDisplayField(
  obj: RawOwnedObject,
  key: string,
): string | null {
  const top = obj.display?.data?.[key];
  if (top != null) return top;
  const nested = obj.data?.display?.data?.[key];
  if (nested != null) return nested;
  return null;
}

/** Normalise an image URL into something `<img src>` can render.
 *  - `ipfs://CID` → `https://gateway.pinata.cloud/ipfs/CID`
 *  - already-http(s) → unchanged
 *  - empty / null → ''
 *  Pure. */
export function normaliseImageUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ipfs://")) {
    return `https://gateway.pinata.cloud/ipfs/${trimmed.slice("ipfs://".length)}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  // bare CIDs (start with `bafy…` or `Qm…`) — treat as Pinata gateway
  if (/^(bafy|Qm)[A-Za-z0-9]+/.test(trimmed)) {
    return `https://gateway.pinata.cloud/ipfs/${trimmed}`;
  }
  return trimmed;
}

/** Predicate: does this owned object qualify as a portrait candidate?
 *  An object qualifies when (a) it has an objectId, (b) it has either a
 *  Display.image_url or Display.name we can render. We DON'T require the
 *  image — pure name-only NFTs render as the name on a gunmetal background
 *  via the picker's failed-image fallback path.
 *  Pure. */
export function isPortraitCandidate(obj: RawOwnedObject): boolean {
  const id = obj.objectId ?? obj.data?.objectId;
  if (!id || typeof id !== "string" || id.length === 0) return false;
  const image = getDisplayField(obj, "image_url");
  const name = getDisplayField(obj, "name");
  return Boolean((image && image.trim()) || (name && name.trim()));
}

/** Convert a raw owned-object into the picker's `NftCandidate` shape.
 *  Returns `null` if the object is not a portrait candidate. Pure. */
export function toNftCandidate(obj: RawOwnedObject): NftCandidate | null {
  if (!isPortraitCandidate(obj)) return null;
  const objectId = (obj.objectId ?? obj.data?.objectId ?? "") as string;
  const typeTag = (obj.type ?? obj.data?.type ?? "") as string;
  const name = (getDisplayField(obj, "name") ?? `NFT ${objectId.slice(0, 10)}`).trim();
  const imageUrl = normaliseImageUrl(getDisplayField(obj, "image_url"));
  return { objectId, name, imageUrl, typeTag };
}

/** Filter + map a raw owned-objects list into candidates ready for the
 *  picker grid. Stable order — preserves input order so the user sees
 *  newest-first or wallet-default-first per upstream choice. Pure. */
export function filterPortraitCandidates(
  objects: ReadonlyArray<RawOwnedObject>,
): NftCandidate[] {
  const out: NftCandidate[] = [];
  for (const obj of objects) {
    const c = toNftCandidate(obj);
    if (c) out.push(c);
  }
  return out;
}

/* ─────────────────────────── state predicates ─────────────────────── */

export type PickerState = "loading" | "empty" | "error" | "ready";

export interface PickerInputs {
  /** True while the RPC fetch is in flight. */
  isLoading: boolean;
  /** Set when the RPC fetch threw. */
  error: string | null;
  /** Resolved list — may be empty even when `error` is null + `isLoading`
   *  is false (wallet has no NFTs). */
  candidates: ReadonlyArray<NftCandidate>;
}

/** Decide which render slot the picker body should mount. Total + pure —
 *  one branch per state. The component's switch statement reads this
 *  result instead of nesting ternaries. */
export function pickerStateOf(inputs: PickerInputs): PickerState {
  if (inputs.isLoading) return "loading";
  if (inputs.error) return "error";
  if (inputs.candidates.length === 0) return "empty";
  return "ready";
}

/* ─────────────────────────── selection state machine ────────────────── */

export interface SelectionState {
  /** The NFT currently chosen IN THE MODAL (not yet committed to portrait). */
  staged: NftCandidate | null;
  /** True when "Set as Portrait" should commit something new — i.e. when
   *  staged differs from the currently-saved portrait. */
  canCommit: boolean;
}

/** Reducer for the picker's selection state. Total + pure — every
 *  branch enumerated, no fallthrough. */
export function nextSelectionState(
  current: SelectionState,
  action:
    | { kind: "pick"; item: NftCandidate }
    | { kind: "clear" }
    | { kind: "reset"; saved: NftCandidate | null },
  saved: NftCandidate | null,
): SelectionState {
  switch (action.kind) {
    case "pick":
      return {
        staged: action.item,
        canCommit: action.item.objectId !== saved?.objectId,
      };
    case "clear":
      // Clearing — if saved is non-null, committing the clear is meaningful;
      // if saved is already null, there's nothing to commit.
      return { staged: null, canCommit: saved !== null };
    case "reset":
      return {
        staged: action.saved,
        canCommit: false,
      };
  }
}

/* ───────────────────────────── localStorage ────────────────────────── */

/** Storage key — same shape used by the design-tool reference. Versioned
 *  so a future schema change doesn't silently load stale data. */
export const PORTRAIT_STORAGE_PREFIX = "sui_combats_portrait_v1";

/** Key one wallet to its own bucket so two wallets on the same browser
 *  get independent portraits. Wallet address lowercased for canonical
 *  matching (some wallets emit mixed-case addresses). Pure. */
export function portraitKeyForWallet(wallet: string | null | undefined): string {
  if (!wallet || typeof wallet !== "string") {
    return `${PORTRAIT_STORAGE_PREFIX}:anon`;
  }
  return `${PORTRAIT_STORAGE_PREFIX}:${wallet.toLowerCase()}`;
}

/** Minimal localStorage shape so tests can inject a stub. */
export interface PortraitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Read the saved portrait for `wallet`. Returns null when none, or when
 *  the stored payload is malformed. Pure (storage injected). */
export function readPortrait(
  storage: PortraitStorage,
  wallet: string | null | undefined,
): NftCandidate | null {
  try {
    const raw = storage.getItem(portraitKeyForWallet(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).objectId === "string" &&
      typeof (parsed as Record<string, unknown>).name === "string"
    ) {
      const p = parsed as Record<string, unknown>;
      return {
        objectId: p.objectId as string,
        name: p.name as string,
        imageUrl: typeof p.imageUrl === "string" ? p.imageUrl : "",
        typeTag: typeof p.typeTag === "string" ? p.typeTag : "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the portrait for `wallet`. Passing `null` removes the entry.
 *  Pure (storage injected). */
export function writePortrait(
  storage: PortraitStorage,
  wallet: string | null | undefined,
  portrait: NftCandidate | null,
): void {
  const key = portraitKeyForWallet(wallet);
  try {
    if (portrait === null) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(portrait));
  } catch {
    // Quota exceeded / disabled storage / SSR — best-effort silent fail.
    // Caller's UI already reflects the new portrait in component state;
    // the persistence layer is a nice-to-have, not load-bearing.
  }
}
