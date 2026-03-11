import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import app from '../../src/index';
import { config } from '../../src/config';

// Mock Prisma
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  })),
}));

// Mock OW service
jest.mock('../../src/services/openWearables', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  createUser: jest.fn(),
  getSdkToken: jest.fn(),
}));

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    it('should register a new user', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'hashed',
      });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
      });
      expect(res.body.tokens).toHaveProperty('accessToken');
      expect(res.body.tokens).toHaveProperty('refreshToken');
    });

    it('should reject duplicate email', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Email already registered');
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockFindUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        passwordHash,
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
      });
      expect(res.body.tokens).toHaveProperty('accessToken');
      expect(res.body.tokens).toHaveProperty('refreshToken');
    });

    it('should reject invalid email', async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'wrong@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('should reject wrong password', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockFindUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        passwordHash,
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const refreshToken = jwt.sign(
        { userId: 'user-1', email: 'test@example.com', type: 'refresh' },
        config.jwtSecret,
        { expiresIn: '7d' },
      );

      mockFindUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.tokens).toHaveProperty('accessToken');
      expect(res.body.tokens).toHaveProperty('refreshToken');
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired refresh token');
    });

    it('should reject access token used as refresh token', async () => {
      const accessToken = jwt.sign(
        { userId: 'user-1', email: 'test@example.com', type: 'access' },
        config.jwtSecret,
        { expiresIn: '15m' },
      );

      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: accessToken });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid token type');
    });

    it('should reject missing refresh token', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });
});
