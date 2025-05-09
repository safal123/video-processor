import express, { Router } from 'express';
import { convertToHls } from '../controllers/videoVontroller';

const router = Router();

// Single route for video operations
router.get('/', convertToHls);

export default router;

