import { Router, Request, Response } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Frighton University SIS Backend API',
    timestamp: new Date().toISOString(),
  });
});
