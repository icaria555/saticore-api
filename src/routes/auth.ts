import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import {
  generateAccessToken,
  generateRefreshToken,
  AuthPayload,
} from '../middleware/auth';
import { config } from '../config';
import * as owService from '../services/openWearables';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

router.post(
  '/register',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = registerSchema.parse(req.body);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new AppError(409, 'Email already registered');
      }

      const passwordHash = await bcrypt.hash(password, 10);

      let owUserId: string | undefined;
      let owSdkToken: string | undefined;
      let owTokenExpiry: Date | undefined;

      if (owService.isConfigured()) {
        try {
          const owUser = await owService.createUser(email);
          owUserId = owUser.id;

          const tokenResult = await owService.getSdkToken(owUser.id);
          owSdkToken = tokenResult.token;
          owTokenExpiry = new Date(tokenResult.expiresAt);
        } catch (error) {
          logger.warn('Failed to provision OW user during registration', {
            error: error instanceof Error ? error.message : 'Unknown',
          });
        }
      }

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          owUserId,
          owSdkToken,
          owTokenExpiry,
        },
      });

      const accessToken = generateAccessToken(user.id, user.email);
      const refreshToken = generateRefreshToken(user.id, user.email);

      res.status(201).json({
        user: { id: user.id, email: user.email },
        tokens: { accessToken, refreshToken },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/login',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = loginSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new AppError(401, 'Invalid email or password');
      }

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        throw new AppError(401, 'Invalid email or password');
      }

      const accessToken = generateAccessToken(user.id, user.email);
      const refreshToken = generateRefreshToken(user.id, user.email);

      res.json({
        user: { id: user.id, email: user.email },
        tokens: { accessToken, refreshToken },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/refresh',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);

      let payload: AuthPayload;
      try {
        payload = jwt.verify(refreshToken, config.jwtSecret) as AuthPayload;
      } catch {
        throw new AppError(401, 'Invalid or expired refresh token');
      }

      if (payload.type !== 'refresh') {
        throw new AppError(401, 'Invalid token type');
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });
      if (!user) {
        throw new AppError(401, 'User not found');
      }

      const newAccessToken = generateAccessToken(user.id, user.email);
      const newRefreshToken = generateRefreshToken(user.id, user.email);

      res.json({
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
