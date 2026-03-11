import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface AuthPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function generateAccessToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email, type: 'access' } satisfies AuthPayload,
    config.jwtSecret,
    { expiresIn: '15m' },
  );
}

export function generateRefreshToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email, type: 'refresh' } satisfies AuthPayload,
    config.jwtSecret,
    { expiresIn: '7d' },
  );
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;

    if (payload.type !== 'access') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    req.user = payload;
    next();
  } catch (error) {
    logger.warn('JWT verification failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
