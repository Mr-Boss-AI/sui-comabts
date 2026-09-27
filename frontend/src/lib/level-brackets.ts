/**
 * v5.3 — items have no rarity, only a level requirement. Shops and bags
 * filter by these level brackets instead.
 */
export const LEVEL_BRACKETS = [
  { id: "1-2", label: "Levels 1–2", min: 1, max: 2 },
  { id: "3-5", label: "Levels 3–5", min: 3, max: 5 },
  { id: "6-10", label: "Levels 6–10", min: 6, max: 10 },
  { id: "11-20", label: "Levels 11–20", min: 11, max: 20 },
] as const;

export type LevelBracketId = (typeof LEVEL_BRACKETS)[number]["id"] | "all";

export function inLevelBracket(levelReq: number, id: LevelBracketId): boolean {
  if (id === "all") return true;
  const b = LEVEL_BRACKETS.find((x) => x.id === id);
  return !!b && levelReq >= b.min && levelReq <= b.max;
}
