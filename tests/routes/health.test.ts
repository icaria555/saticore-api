import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/index';
import { config } from '../../src/config';

// Mock Prisma
const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockDeviceFindMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: {
      findUnique: mockUserFindUnique,
      create: jest.fn(),
      update: mockUserUpdate,
    },
    device: {
      findMany: mockDeviceFindMany,
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  })),
}));

// Mock OW service
const mockFetchTimeSeries = jest.fn();
const mockRefreshTokenIfNeeded = jest.fn();

jest.mock('../../src/services/openWearables', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  fetchTimeSeries: mockFetchTimeSeries,
  refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
}));

function makeToken(userId: string = 'user-1'): string {
  return jwt.sign(
    { userId, email: 'test@example.com', type: 'access' },
    config.jwtSecret,
    { expiresIn: '15m' },
  );
}

describe('Health Routes', () => {
  const token = makeToken();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return health check without auth', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /health/status', () => {
    it('should return connected status when device exists', async () => {
      mockDeviceFindMany.mockResolvedValue([
        {
          id: 'device-1',
          name: 'My Watch',
          status: 'connected',
          lastSeen: new Date('2026-03-10T12:00:00Z'),
        },
      ]);

      const res = await request(app)
        .get('/health/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.deviceName).toBe('My Watch');
    });

    it('should return disconnected when no device', async () => {
      mockDeviceFindMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/health/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
      expect(res.body.deviceName).toBeNull();
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/health/status');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /health/data', () => {
    it('should fetch health data from OW API', async () => {
      mockUserFindUnique.mockResolvedValue({
        owUserId: 'ow-user-1',
        owSdkToken: 'sdk-token',
        owTokenExpiry: new Date(Date.now() + 3600000),
      });
      mockRefreshTokenIfNeeded.mockResolvedValue(null);
      mockFetchTimeSeries.mockResolvedValue([
        {
          heartRate: 72,
          hrv: 45,
          respiratoryRate: 16,
          timestamp: '2026-03-10T12:00:00Z',
        },
      ]);

      const res = await request(app)
        .get('/health/data')
        .query({
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          start: '2026-03-10T12:00:00Z',
          end: '2026-03-10T12:10:00Z',
        })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].heartRate).toBe(72);
    });

    it('should return 400 when no OW device connected', async () => {
      mockUserFindUnique.mockResolvedValue({
        owUserId: null,
        owSdkToken: null,
        owTokenExpiry: null,
      });

      const res = await request(app)
        .get('/health/data')
        .query({
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          start: '2026-03-10T12:00:00Z',
          end: '2026-03-10T12:10:00Z',
        })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No wearable device connected');
    });
  });
});
