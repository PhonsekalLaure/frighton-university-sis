import express, { Express } from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { healthRouter } from './routes/healthRoutes.js';
import { integrationRouter } from './routes/integrationRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';

export const createApp = (): Express => {
  const app = express();

  // Standard middleware
  app.use(cors({
    origin: config.clientUrl,
    credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/v1/integration', integrationRouter);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
};
