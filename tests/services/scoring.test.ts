import { calculateScore, validateScore, ScoreInput } from '../../src/services/scoring';

describe('Scoring Service', () => {
  describe('calculateScore', () => {
    it('should return full score for ideal meditation session', () => {
      // HR drops from 80 to 65 (15 bpm drop > 10 threshold)
      const heartRateSamples = [
        82, 80, 79, 78, // first quarter ~80
        76, 75, 74, 73,
        72, 70, 69, 68,
        67, 66, 65, 64, // last quarter ~65.5
      ];

      // HRV increases from 30 to 50 (20 ms > 15 threshold)
      const hrvSamples = [
        28, 30, 31, 32,
        35, 37, 38, 40,
        42, 44, 45, 46,
        48, 50, 52, 54,
      ];

      const input: ScoreInput = {
        heartRateSamples,
        hrvSamples,
        actualDurationSec: 600,
        targetDurationSec: 600,
      };

      const result = calculateScore(input);

      expect(result.total).toBeGreaterThanOrEqual(80);
      expect(result.heartRateCalming).toBe(25);
      expect(result.hrvImprovement).toBe(25);
      expect(result.completionBonus).toBe(25);
    });

    it('should return low score for poor session', () => {
      // HR increases (bad)
      const heartRateSamples = [60, 65, 70, 75, 80, 85, 90, 95];

      // HRV decreases (bad)
      const hrvSamples = [50, 45, 40, 35, 30, 25, 20, 15];

      const input: ScoreInput = {
        heartRateSamples,
        hrvSamples,
        actualDurationSec: 120,
        targetDurationSec: 600,
      };

      const result = calculateScore(input);

      expect(result.total).toBeLessThan(30);
      expect(result.heartRateCalming).toBe(0);
      expect(result.hrvImprovement).toBe(0);
      expect(result.completionBonus).toBe(0);
    });

    it('should give partial completion bonus at 75%', () => {
      const input: ScoreInput = {
        heartRateSamples: [70, 70],
        hrvSamples: [40, 40],
        actualDurationSec: 450,
        targetDurationSec: 600,
      };

      const result = calculateScore(input);

      // 75% completion: (0.75 - 0.5) / 0.5 = 0.5 * 25 = 12.5 -> 13
      expect(result.completionBonus).toBe(13);
    });

    it('should give zero completion bonus below 50%', () => {
      const input: ScoreInput = {
        heartRateSamples: [70],
        hrvSamples: [40],
        actualDurationSec: 200,
        targetDurationSec: 600,
      };

      const result = calculateScore(input);

      expect(result.completionBonus).toBe(0);
    });

    it('should handle empty samples with partial scores', () => {
      const input: ScoreInput = {
        heartRateSamples: [],
        hrvSamples: [],
        actualDurationSec: 600,
        targetDurationSec: 600,
      };

      const result = calculateScore(input);

      // Empty samples should get 50% of each category weight
      expect(result.heartRateCalming).toBe(13); // 25 * 0.5 rounded
      expect(result.hrvImprovement).toBe(13);
      expect(result.breathingSteadiness).toBe(13);
      expect(result.completionBonus).toBe(25);
    });

    it('should handle zero target duration', () => {
      const input: ScoreInput = {
        heartRateSamples: [70, 70, 70, 70],
        hrvSamples: [40, 40, 40, 40],
        actualDurationSec: 300,
        targetDurationSec: 0,
      };

      const result = calculateScore(input);
      expect(result.completionBonus).toBe(0);
    });
  });

  describe('validateScore', () => {
    it('should validate matching scores within tolerance', () => {
      const input: ScoreInput = {
        heartRateSamples: [80, 78, 75, 72, 70, 68, 66, 64],
        hrvSamples: [30, 32, 35, 38, 40, 42, 45, 48],
        actualDurationSec: 600,
        targetDurationSec: 600,
      };

      const serverResult = calculateScore(input);
      const { valid, serverScore } = validateScore(serverResult.total, input);

      expect(valid).toBe(true);
      expect(serverScore.total).toBe(serverResult.total);
    });

    it('should reject scores outside tolerance', () => {
      const input: ScoreInput = {
        heartRateSamples: [80, 78, 75, 72, 70, 68, 66, 64],
        hrvSamples: [30, 32, 35, 38, 40, 42, 45, 48],
        actualDurationSec: 600,
        targetDurationSec: 600,
      };

      const { valid } = validateScore(100, input);

      // Unless the actual score is close to 100, this should fail
      const serverResult = calculateScore(input);
      if (Math.abs(100 - serverResult.total) > 5) {
        expect(valid).toBe(false);
      }
    });

    it('should accept scores within custom tolerance', () => {
      const input: ScoreInput = {
        heartRateSamples: [70, 70, 70, 70],
        hrvSamples: [40, 40, 40, 40],
        actualDurationSec: 600,
        targetDurationSec: 600,
      };

      const serverResult = calculateScore(input);
      const { valid } = validateScore(serverResult.total + 10, input, 10);

      expect(valid).toBe(true);
    });
  });
});
