import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/index';
import { config } from '../../src/config';

// Mock Prisma
const mockSessionCreate = jest.fn();
const mockSessionFindMany = jest.fn();
const mockSessionFindFirst = jest.fn();
const mockSessionCount = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    session: {
      create: mockSessionCreate,
      findMany: mockSessionFindMany,
      findFirst: mockSessionFindFirst,
      count: mockSessionCount,
    },
    device: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  })),
}));

jest.mock('../../src/services/openWearables', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
}));

function makeToken(userId: string = 'user-1'): string {
  return jwt.sign(
    { userId, email: 'test@example.com', type: 'access' },
    config.jwtSecret,
    { expiresIn: '15m' },
  );
}

describe('Sessions Routes', () => {
  const token = makeToken();
  const now = new Date();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /sessions', () => {
    it('should create a session', async () => {
      const sessionData = {
        durationTarget: 600,
        durationActual: 580,
        score: 72,
        scoreBreakdown: {
          total: 72,
          heartRateCalming: 20,
          hrvImprovement: 18,
          breathingSteadiness: 22,
          completionBonus: 12,
        },
        status: 'completed',
        startedAt: now.toISOString(),
        completedAt: new Date(now.getTime() + 580000).toISOString(),
        healthData: {
          heartRateSamples: [
            { timestamp: now.toISOString(), type: 'heart_rate', value: 72, unit: 'bpm' },
          ],
          hrvSamples: [
            { timestamp: now.toISOString(), type: 'hrv', value: 45, unit: 'ms' },
          ],
          respiratoryRateSamples: [],
        },
      };

      mockSessionCreate.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        ...sessionData,
        startedAt: now,
        completedAt: new Date(now.getTime() + 580000),
        createdAt: now,
        healthSamples: [
          {
            id: 'hs-1',
            sessionId: 'session-1',
            heartRate: 72,
            hrv: 45,
            respiratoryRate: null,
            timestamp: now,
          },
        ],
      });

      const res = await request(app)
        .post('/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send(sessionData);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('session-1');
      expect(res.body.score).toBe(72);
      expect(res.body.healthSamples).toHaveLength(1);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .post('/sessions')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('GET /sessions', () => {
    it('should list sessions with pagination', async () => {
      mockSessionFindMany.mockResolvedValue([
        {
          id: 'session-1',
          durationTarget: 600,
          durationActual: 580,
          score: 72,
          scoreBreakdown: null,
          status: 'completed',
          startedAt: now,
          completedAt: now,
          healthSamples: [],
        },
      ]);
      mockSessionCount.mockResolvedValue(1);

      const res = await request(app)
        .get('/sessions?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
    });

    it('should use default pagination', async () => {
      mockSessionFindMany.mockResolvedValue([]);
      mockSessionCount.mockResolvedValue(0);

      const res = await request(app)
        .get('/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
    });
  });

  describe('GET /sessions/:id', () => {
    it('should return a session by id', async () => {
      mockSessionFindFirst.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        durationTarget: 600,
        durationActual: 580,
        score: 72,
        scoreBreakdown: null,
        status: 'completed',
        startedAt: now,
        completedAt: now,
        healthSamples: [],
      });

      const res = await request(app)
        .get('/sessions/session-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('session-1');
    });

    it('should return 404 for non-existent session', async () => {
      mockSessionFindFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/sessions/nonexistent')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });
  });
});
