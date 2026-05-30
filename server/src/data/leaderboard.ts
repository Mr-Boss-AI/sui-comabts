import type { LeaderboardEntry } from '../types';
import { getAllCharacters } from './characters';

// === Leaderboard ===

/**
 * Get the top N players by rating.
 * Computed on-demand from the character store.
 */
export function getLeaderboard(limit: number = 100): LeaderboardEntry[] {
  const allChars = getAllCharacters();

  // Sort by rating descending, then by wins descending as tiebreaker.
  // Filter counts draws as fights too — a character that's only drawn
  // still has shown up to the arena and deserves a ladder slot.
  const sorted = allChars
    .filter((c) => c.wins + c.losses + c.draws > 0)
    .sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    })
    .slice(0, limit);

  return sorted.map((char, index) => ({
    rank: index + 1,
    walletAddress: char.walletAddress,
    characterName: char.name,
    rating: char.rating,
    wins: char.wins,
    losses: char.losses,
    draws: char.draws,
    level: char.level,
    stats: { ...char.stats },
  }));
}

/**
 * Get a specific player's rank.
 */
export function getPlayerRank(walletAddress: string): number | null {
  const leaderboard = getLeaderboard(1000);
  const entry = leaderboard.find((e) => e.walletAddress === walletAddress);
  return entry ? entry.rank : null;
}
