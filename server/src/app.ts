import express, { Express } from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { authRouter } from './routes/authRoutes.js';
import { healthRouter } from './routes/healthRoutes.js';
import { integrationRouter } from './routes/integrationRoutes.js';
import { dashboardRouter } from './routes/dashboardRoutes.js';
import { scheduleRouter } from './routes/scheduleRoutes.js';
import { protectCookieRequests } from './middlewares/auth.js';
import { errorHandler } from './middlewares/errorHandler.js';

export const createApp = (): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    if (config.nodeEnv === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(protectCookieRequests);
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/v1/integration', integrationRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/schedule', scheduleRouter);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
};
