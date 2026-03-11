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

export default router;
