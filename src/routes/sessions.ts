import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const prisma = new PrismaClient();

const createSessionSchema = z.object({
  durationTarget: z.number().int().positive(),
  durationActual: z.number().int().min(0),
  score: z.number().int().min(0).max(100).nullable(),
  scoreBreakdown: z
    .object({
      total: z.number(),
      heartRateCalming: z.number(),
      hrvImprovement: z.number(),
      breathingSteadiness: z.number(),
      completionBonus: z.number(),
    })
    .nullable(),
  status: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  healthData: z.object({
    heartRateSamples: z.array(
      z.object({
        timestamp: z.string(),
        type: z.string(),
        value: z.number(),
        unit: z.string(),
      }),
    ),
    hrvSamples: z.array(
      z.object({
        timestamp: z.string(),
        type: z.string(),
        value: z.number(),
        unit: z.string(),
      }),
    ),
    respiratoryRateSamples: z.array(
      z.object({
        timestamp: z.string(),
        type: z.string(),
        value: z.number(),
        unit: z.string(),
      }),
    ),
  }),
});

const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => parseInt(v || '1', 10))
    .pipe(z.number().int().positive()),
  limit: z
    .string()
    .optional()
    .transform((v) => parseInt(v || '20', 10))
    .pipe(z.number().int().min(1).max(100)),
});

router.post(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = createSessionSchema.parse(req.body);
      const userId = req.user!.userId;

      // Build health samples from all three sample arrays
      const healthSamples: Array<{
        heartRate: number | null;
        hrv: number | null;
        respiratoryRate: number | null;
        timestamp: Date;
      }> = [];

      const timestampMap = new Map<
        string,
        { heartRate: number | null; hrv: number | null; respiratoryRate: number | null }
      >();

      for (const sample of data.healthData.heartRateSamples) {
        const entry = timestampMap.get(sample.timestamp) ?? {
          heartRate: null,
          hrv: null,
          respiratoryRate: null,
        };
        entry.heartRate = sample.value;
        timestampMap.set(sample.timestamp, entry);
      }

      for (const sample of data.healthData.hrvSamples) {
        const entry = timestampMap.get(sample.timestamp) ?? {
          heartRate: null,
          hrv: null,
          respiratoryRate: null,
        };
        entry.hrv = sample.value;
        timestampMap.set(sample.timestamp, entry);
      }

      for (const sample of data.healthData.respiratoryRateSamples) {
        const entry = timestampMap.get(sample.timestamp) ?? {
          heartRate: null,
          hrv: null,
          respiratoryRate: null,
        };
        entry.respiratoryRate = sample.value;
        timestampMap.set(sample.timestamp, entry);
      }

      for (const [timestamp, values] of timestampMap) {
        healthSamples.push({
          ...values,
          timestamp: new Date(timestamp),
        });
      }

      const session = await prisma.session.create({
        data: {
          userId,
          durationTarget: data.durationTarget,
          durationActual: data.durationActual,
          score: data.score,
          scoreBreakdown: data.scoreBreakdown === null
            ? Prisma.JsonNull
            : (data.scoreBreakdown as Prisma.InputJsonValue),
          status: data.status,
          startedAt: new Date(data.startedAt),
          completedAt: data.completedAt ? new Date(data.completedAt) : null,
          healthSamples: {
            create: healthSamples,
          },
        },
        include: {
          healthSamples: true,
        },
      });

      res.status(201).json({
        id: session.id,
        durationTarget: session.durationTarget,
        durationActual: session.durationActual,
        score: session.score,
        scoreBreakdown: session.scoreBreakdown,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt?.toISOString() ?? null,
        healthSamples: session.healthSamples.map((hs) => ({
          heartRate: hs.heartRate,
          hrv: hs.hrv,
          respiratoryRate: hs.respiratoryRate,
          timestamp: hs.timestamp.toISOString(),
        })),
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
      const { page, limit } = paginationSchema.parse(req.query);
      const userId = req.user!.userId;
      const skip = (page - 1) * limit;

      const [sessions, total] = await Promise.all([
        prisma.session.findMany({
          where: { userId },
          orderBy: { startedAt: 'desc' },
          skip,
          take: limit,
          include: { healthSamples: true },
        }),
        prisma.session.count({ where: { userId } }),
      ]);

      res.json({
        sessions: sessions.map((s) => ({
          id: s.id,
          durationTarget: s.durationTarget,
          durationActual: s.durationActual,
          score: s.score,
          scoreBreakdown: s.scoreBreakdown,
          status: s.status,
          startedAt: s.startedAt.toISOString(),
          completedAt: s.completedAt?.toISOString() ?? null,
          healthSamples: s.healthSamples.map((hs) => ({
            heartRate: hs.heartRate,
            hrv: hs.hrv,
            respiratoryRate: hs.respiratoryRate,
            timestamp: hs.timestamp.toISOString(),
          })),
        })),
        total,
        page,
        limit,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const sessionId = req.params.id;

      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId },
        include: { healthSamples: true },
      });

      if (!session) {
        throw new AppError(404, 'Session not found');
      }

      res.json({
        id: session.id,
        durationTarget: session.durationTarget,
        durationActual: session.durationActual,
        score: session.score,
        scoreBreakdown: session.scoreBreakdown,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt?.toISOString() ?? null,
        healthSamples: session.healthSamples.map((hs) => ({
          heartRate: hs.heartRate,
          hrv: hs.hrv,
          respiratoryRate: hs.respiratoryRate,
          timestamp: hs.timestamp.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
