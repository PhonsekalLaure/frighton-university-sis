import { Router, Request, Response } from 'express';
import { config } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Frighton University Student Information System (SIS) API',
    port: config.port,
    timestamp: new Date().toISOString(),
  });
});
