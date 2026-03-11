import express from 'express';
import cors from 'cors';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import sessionRoutes from './routes/sessions';
import deviceRoutes from './routes/devices';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);
app.use('/sessions', sessionRoutes);
app.use('/devices', deviceRoutes);

// Error handler
app.use(errorHandler);

// Start server (only when not in test)
if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    logger.info(`SatiCore API running on port ${config.port}`);
  });
}

export default app;
