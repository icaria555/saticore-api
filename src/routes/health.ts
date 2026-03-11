import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import * as owService from '../services/openWearables';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

const healthDataQuerySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  start: z.string().datetime({ message: 'Invalid start time' }),
  end: z.string().datetime({ message: 'Invalid end time' }),
});

router.get(
  '/status',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;

      const devices = await prisma.device.findMany({
        where: { userId },
        orderBy: { lastSeen: 'desc' },
        take: 1,
      });

      if (devices.length === 0) {
        res.json({
          connected: false,
          deviceName: null,
          lastSeen: null,
        });
        return;
      }

      const device = devices[0];
      res.json({
        connected: device.status === 'connected',
        deviceName: device.name,
        lastSeen: device.lastSeen?.toISOString() ?? null,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/data',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = healthDataQuerySchema.parse(req.query);
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { owUserId: true, owSdkToken: true, owTokenExpiry: true },
      });

      if (!user?.owUserId || !user?.owSdkToken) {
        throw new AppError(400, 'No wearable device connected');
      }

      // Refresh OW token if needed
      let sdkToken = user.owSdkToken;
      const refreshed = await owService.refreshTokenIfNeeded(
        user.owUserId,
        user.owTokenExpiry,
      );
      if (refreshed) {
        sdkToken = refreshed.token;
        await prisma.user.update({
          where: { id: userId },
          data: {
            owSdkToken: refreshed.token,
            owTokenExpiry: new Date(refreshed.expiresAt),
          },
        });
      }

      const samples = await owService.fetchTimeSeries(
        user.owUserId,
        sdkToken,
        query.start,
        query.end,
      );

      res.json(samples);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
