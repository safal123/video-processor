import express, { Request, Response, Router } from 'express';
import { logger } from '../utils';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  logger.info('Health check route called');
  res.status(200).json({
    status: 'ok',

  });
});

export default router;

