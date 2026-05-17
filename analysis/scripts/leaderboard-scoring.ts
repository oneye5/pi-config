/**
 * Shared leaderboard scoring constants used by both the Node-side generator and the browser dashboard.
 * Keep this module dependency-free so both build targets can import it safely.
 */
export const LEADERBOARD_MINIMUM_SCORED_RUNS = 3;
export const LEADERBOARD_TARGET_SAMPLE = 10;
export const LEADERBOARD_TOKEN_EFFICIENCY_MAX = 50;
export const LEADERBOARD_WEIGHTS = {
  satisfaction: 0.35,
  resolutionRate: 0.30,
  firstAttemptSuccess: 0.15,
  toolReliability: 0.10,
  verificationAdoption: 0.05,
  tokenEfficiency: 0.05,
} as const;
