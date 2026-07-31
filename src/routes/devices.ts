import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import * as owService from '../services/openWearables';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

const connectDeviceSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required'),
});

router.post(
  '/connect',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { deviceId } = connectDeviceSchema.parse(req.body);
      const userId = req.user!.userId;

      // Check if device is already connected for this user
      const existingDevice = await prisma.device.findFirst({
        where: { userId, owDeviceId: deviceId },
      });

      if (existingDevice) {
        // Update existing device
        const updated = await prisma.device.update({
          where: { id: existingDevice.id },
          data: {
            status: 'connected',
            lastSeen: new Date(),
          },
        });

        res.json({
          id: updated.id,
          owDeviceId: updated.owDeviceId,
          name: updated.name,
          status: updated.status,
          lastSeen: updated.lastSeen?.toISOString() ?? null,
        });
        return;
      }

      // Create new device record
      const device = await prisma.device.create({
        data: {
          userId,
          owDeviceId: deviceId,
          name: `Device ${deviceId.slice(0, 8)}`,
          status: 'connected',
          lastSeen: new Date(),
        },
      });

      res.status(201).json({
        id: device.id,
        owDeviceId: device.owDeviceId,
        name: device.name,
        status: device.status,
        lastSeen: device.lastSeen?.toISOString() ?? null,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;

      const devices = await prisma.device.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      res.json(
        devices.map((d) => ({
          id: d.id,
          owDeviceId: d.owDeviceId,
          name: d.name,
          status: d.status,
          lastSeen: d.lastSeen?.toISOString() ?? null,
        })),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/available',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { owUserId: true, owSdkToken: true, owTokenExpiry: true },
      });

      if (!user?.owUserId || !user?.owSdkToken) {
        // User hasn't been provisioned on Open Wearables yet
        res.json([]);
        return;
      }

      let sdkToken = user.owSdkToken;
      try {
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
      } catch (error) {
        logger.warn('Open Wearables token refresh unavailable; returning empty device list', {
          error: error instanceof Error ? error.message : 'Unknown',
        });
        res.json([]);
        return;
      }

      let connections: owService.OWConnection[];
      try {
        connections = await owService.fetchUserConnections(
          user.owUserId,
          sdkToken,
        );
      } catch (error) {
        logger.warn('Open Wearables connections unavailable; returning empty device list', {
          error: error instanceof Error ? error.message : 'Unknown',
        });
        connections = [];
      }

      res.json(connections);
    } catch (error) {
      next(error);
    }
  },
);

// List supported wearable providers
router.get(
  '/providers',
  authenticate,
  async (_req: Request, res: Response): Promise<void> => {
    res.json(owService.SUPPORTED_PROVIDERS);
  },
);

// Start OAuth flow to link a wearable provider
const oauthStartSchema = z.object({
  provider: z.string().min(1, 'Provider is required'),
  redirectUri: z.string().url().optional(),
});

router.post(
  '/link',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { provider, redirectUri } = oauthStartSchema.parse(req.body);
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { owUserId: true, owSdkToken: true, owTokenExpiry: true },
      });

      if (!user?.owUserId) {
        throw new AppError(400, 'Account not linked to Open Wearables. Please re-register.');
      }

      if (user.owSdkToken) {
        try {
          const refreshed = await owService.refreshTokenIfNeeded(
            user.owUserId,
            user.owTokenExpiry,
          );
          if (refreshed) {
            await prisma.user.update({
              where: { id: userId },
              data: {
                owSdkToken: refreshed.token,
                owTokenExpiry: new Date(refreshed.expiresAt),
              },
            });
          }
        } catch (error) {
          logger.warn('Open Wearables token refresh unavailable during OAuth link', {
            provider,
            error: error instanceof Error ? error.message : 'Unknown',
          });
          throw new AppError(503, 'Open Wearables is currently unavailable');
        }
      }

      let result;
      try {
        result = await owService.getOAuthUrl(
          user.owUserId,
          provider,
          redirectUri,
        );
      } catch (error) {
        logger.warn('Open Wearables OAuth link unavailable', {
          provider,
          error: error instanceof Error ? error.message : 'Unknown',
        });
        throw new AppError(503, 'Open Wearables is currently unavailable');
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
