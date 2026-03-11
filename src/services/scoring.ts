export interface ScoreInput {
  heartRateSamples: number[];
  hrvSamples: number[];
  actualDurationSec: number;
  targetDurationSec: number;
}

export interface ScoreResult {
  total: number;
  heartRateCalming: number;
  hrvImprovement: number;
  breathingSteadiness: number;
  completionBonus: number;
}

const WEIGHTS = {
  heartRateCalming: 25,
  hrvImprovement: 25,
  breathingSteadiness: 25,
  completionBonus: 25,
} as const;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = average(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(average(squaredDiffs));
}

/**
 * Heart Rate Calming (0-25):
 * Measures how much heart rate decreased from first to last quarter.
 * A drop of 10+ bpm = full score.
 */
function scoreHeartRateCalming(hrs: number[]): number {
  if (hrs.length < 4) return WEIGHTS.heartRateCalming * 0.5;

  const quarter = Math.max(1, Math.floor(hrs.length / 4));
  const firstQuarterAvg = average(hrs.slice(0, quarter));
  const lastQuarterAvg = average(hrs.slice(-quarter));
  const drop = firstQuarterAvg - lastQuarterAvg;

  const normalized = Math.min(1, Math.max(0, drop / 10));
  return Math.round(normalized * WEIGHTS.heartRateCalming);
}

/**
 * HRV Improvement (0-25):
 * Higher HRV indicates parasympathetic activation.
 * An increase of 15+ ms = full score.
 */
function scoreHrvImprovement(hrvs: number[]): number {
  if (hrvs.length < 4) return WEIGHTS.hrvImprovement * 0.5;

  const quarter = Math.max(1, Math.floor(hrvs.length / 4));
  const firstQuarterAvg = average(hrvs.slice(0, quarter));
  const lastQuarterAvg = average(hrvs.slice(-quarter));
  const increase = lastQuarterAvg - firstQuarterAvg;

  const normalized = Math.min(1, Math.max(0, increase / 15));
  return Math.round(normalized * WEIGHTS.hrvImprovement);
}

/**
 * Breathing Steadiness (0-25):
 * Low HR standard deviation indicates steady breathing.
 * SD < 3 bpm = full, SD > 12 bpm = zero.
 */
function scoreBreathingSteadiness(hrs: number[]): number {
  if (hrs.length < 2) return WEIGHTS.breathingSteadiness * 0.5;

  const sd = standardDeviation(hrs);
  const normalized = Math.min(1, Math.max(0, 1 - (sd - 3) / 9));
  return Math.round(normalized * WEIGHTS.breathingSteadiness);
}

/**
 * Completion Bonus (0-25):
 * Full score for 100% of target duration.
 * Proportional for partial (minimum 50% to get any points).
 */
function scoreCompletion(actualSec: number, targetSec: number): number {
  if (targetSec <= 0) return 0;
  const ratio = actualSec / targetSec;
  if (ratio < 0.5) return 0;
  const normalized = Math.min(1, (ratio - 0.5) / 0.5);
  return Math.round(normalized * WEIGHTS.completionBonus);
}

export function calculateScore(input: ScoreInput): ScoreResult {
  const heartRateCalming = scoreHeartRateCalming(input.heartRateSamples);
  const hrvImprovement = scoreHrvImprovement(input.hrvSamples);
  const breathingSteadiness = scoreBreathingSteadiness(input.heartRateSamples);
  const completionBonus = scoreCompletion(
    input.actualDurationSec,
    input.targetDurationSec,
  );

  return {
    total: heartRateCalming + hrvImprovement + breathingSteadiness + completionBonus,
    heartRateCalming,
    hrvImprovement,
    breathingSteadiness,
    completionBonus,
  };
}

/**
 * Validates a client-submitted score against server-calculated score.
 * Returns true if the scores match within a tolerance of 5 points.
 */
export function validateScore(
  clientScore: number,
  input: ScoreInput,
  tolerance: number = 5,
): { valid: boolean; serverScore: ScoreResult } {
  const serverScore = calculateScore(input);
  const diff = Math.abs(clientScore - serverScore.total);
  return {
    valid: diff <= tolerance,
    serverScore,
  };
}
