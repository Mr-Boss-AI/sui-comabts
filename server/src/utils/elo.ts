import { GAME_CONSTANTS } from '../config';

/**
 * Standard ELO rating calculation.
 * K-factor = 32, minimum rating = 100.
 */

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function calculateEloChange(
  winnerRating: number,
  loserRating: number
): { winnerNew: number; loserNew: number; winnerDelta: number; loserDelta: number } {
  const K = GAME_CONSTANTS.ELO_K_FACTOR;
  const MIN = GAME_CONSTANTS.ELO_MIN_RATING;

  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser = expectedScore(loserRating, winnerRating);

  const winnerDelta = Math.round(K * (1 - expectedWinner));
  const loserDelta = Math.round(K * (0 - expectedLoser));

  const winnerNew = Math.max(MIN, winnerRating + winnerDelta);
  const loserNew = Math.max(MIN, loserRating + loserDelta);

  return {
    winnerNew,
    loserNew,
    winnerDelta,
    loserDelta,
  };
}

/**
 * Calculate XP reward based on fight type and rating difference.
 */
export function calculateXpReward(
  _fightType: string,
  isWinner: boolean,
  _winnerRating: number,
  _loserRating: number
): number {
  if (!isWinner) return 0;
  return randomInt(GAME_CONSTANTS.XP_WIN_MIN, GAME_CONSTANTS.XP_WIN_MAX);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
