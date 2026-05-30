/**
 * Hall of Fame — pure filter + build classifier helpers.
 *
 * Two filter dimensions:
 *  1. Level bucket — reuses the Tavern's SIDEBAR_BUCKETS so the
 *     aesthetic + boundaries are single-source-of-truth across both
 *     surfaces. Plus an "all" sentinel that bypasses bucketing.
 *  2. Build type — classified from stat distribution. Crit (STR-led),
 *     Evasion (DEX-led), Tank (END-led), Hybrid (no dominant stat or
 *     stats missing from wire). INT isn't a primary archetype in our
 *     combat math (it feeds crit + evasion as secondary), so we don't
 *     surface an "INT build" — INT-led entries fall into Hybrid.
 *
 * Pure module — no React, no DOM, no I/O. Tested by `qa-hall-of-fame.ts`.
 */

import type { CharacterStats, LeaderboardEntry } from "../types/game";
import { SIDEBAR_BUCKETS, type SidebarBucketDef } from "./player-bucket";

// === Level buckets ===

export type LevelFilter = "all" | string; // key from SIDEBAR_BUCKETS

export interface LevelBucketOption {
  key: LevelFilter;
  label: string;
  /** Inclusive min level — `0` only on the "all" sentinel. */
  minLevel: number;
  /** Inclusive max level — `9999` on the "all" sentinel + "hall" bucket. */
  maxLevel: number;
}

const ALL_BUCKET_OPTION: LevelBucketOption = {
  key: "all",
  label: "All Levels",
  minLevel: 0,
  maxLevel: 9999,
};

/** All level bucket options, with "All" first, then every Tavern
 *  sidebar bucket in level order. UI renders these as chips. */
export const LEVEL_BUCKET_OPTIONS: ReadonlyArray<LevelBucketOption> = [
  ALL_BUCKET_OPTION,
  ...SIDEBAR_BUCKETS.map((b: SidebarBucketDef) => ({
    key: b.key,
    label: b.label,
    minLevel: b.minLevel,
    maxLevel: b.maxLevel,
  })),
];

/** Inclusive range check. "all" matches everything. */
export function levelBucketContains(bucketKey: LevelFilter, level: number): boolean {
  if (bucketKey === "all") return true;
  const def = LEVEL_BUCKET_OPTIONS.find((b) => b.key === bucketKey);
  if (!def) return false;
  return level >= def.minLevel && level <= def.maxLevel;
}

// === Build classifier ===

export type BuildType = "crit" | "evasion" | "tank" | "hybrid";

export type BuildFilter = "all" | BuildType;

export const BUILD_FILTER_OPTIONS: ReadonlyArray<{
  key: BuildFilter;
  label: string;
}> = [
  { key: "all", label: "All Builds" },
  { key: "crit", label: "Crit" },
  { key: "evasion", label: "Evasion" },
  { key: "tank", label: "Tank" },
  { key: "hybrid", label: "Hybrid" },
];

/** Threshold — a stat must exceed this fraction of allocated points to
 *  count as the dominant build. Below this, the build is Hybrid. The
 *  ratio is computed against the OPTIONAL/allocated stat budget (sum
 *  of STR + DEX + INT + END), not against any base. Hand-tuned so a
 *  player with a 50 / 30 / 10 / 10 split classifies as Crit, but
 *  35 / 30 / 20 / 15 stays Hybrid. */
export const BUILD_DOMINANCE_THRESHOLD = 0.45;

export function classifyBuild(stats: CharacterStats | undefined | null): BuildType {
  if (!stats) return "hybrid";
  const { strength, dexterity, intuition, endurance } = stats;
  const total = strength + dexterity + intuition + endurance;
  if (total <= 0) return "hybrid";
  const ratios = {
    crit: strength / total,
    evasion: dexterity / total,
    tank: endurance / total,
    intuition: intuition / total,
  };
  // Find the max of STR/DEX/END (INT doesn't get its own archetype —
  // it falls into Hybrid).
  const candidates: Array<{ key: BuildType; ratio: number }> = [
    { key: "crit", ratio: ratios.crit },
    { key: "evasion", ratio: ratios.evasion },
    { key: "tank", ratio: ratios.tank },
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (c.ratio > best.ratio) best = c;
  }
  // If INT is the largest of all four stats, the build is INT-led — Hybrid
  // (we don't expose INT as a build archetype today).
  if (ratios.intuition > best.ratio) return "hybrid";
  return best.ratio >= BUILD_DOMINANCE_THRESHOLD ? best.key : "hybrid";
}

// === Composite filter ===

export interface FilterState {
  level: LevelFilter;
  build: BuildFilter;
  search?: string;
}

export function entryMatches(entry: LeaderboardEntry, state: FilterState): boolean {
  if (!levelBucketContains(state.level, entry.level)) return false;
  if (state.build !== "all") {
    if (classifyBuild(entry.stats) !== state.build) return false;
  }
  const search = state.search?.trim().toLowerCase() ?? "";
  if (search && !entry.name.toLowerCase().includes(search)) return false;
  return true;
}

export function filterEntries(
  entries: ReadonlyArray<LeaderboardEntry>,
  state: FilterState,
): LeaderboardEntry[] {
  return entries.filter((e) => entryMatches(e, state));
}

// === Bucket counts (drives live counts on the chip labels) ===

/** Returns `{ all, novice, early, ..., hall }`. Used by the chip
 *  row to show "Novice · 12" next to each bucket. */
export function levelBucketCounts(
  entries: ReadonlyArray<LeaderboardEntry>,
): Record<LevelFilter, number> {
  const counts: Record<string, number> = {};
  for (const opt of LEVEL_BUCKET_OPTIONS) counts[opt.key] = 0;
  for (const entry of entries) {
    counts.all += 1;
    for (const opt of LEVEL_BUCKET_OPTIONS) {
      if (opt.key === "all") continue;
      if (levelBucketContains(opt.key, entry.level)) counts[opt.key] += 1;
    }
  }
  return counts as Record<LevelFilter, number>;
}

/** Returns `{ all, crit, evasion, tank, hybrid }`. */
export function buildCounts(
  entries: ReadonlyArray<LeaderboardEntry>,
): Record<BuildFilter, number> {
  const counts: Record<string, number> = {
    all: entries.length,
    crit: 0,
    evasion: 0,
    tank: 0,
    hybrid: 0,
  };
  for (const entry of entries) {
    counts[classifyBuild(entry.stats)] += 1;
  }
  return counts as Record<BuildFilter, number>;
}
