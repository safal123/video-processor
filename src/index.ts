import * as dotenv from "dotenv";
dotenv.config()

import express, { Request, Response, NextFunction } from "express";
import { logger } from './utils/index.js'
import cors from 'cors';
import healthCheckRouter from './routers/healthCheckRouter'
import videoRouter from './routers/videoRouter'

// Initialize Express app
const app = express()
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));


dotenv.config()

app.use('/health', healthCheckRouter)
app.use('/objects', videoRouter)

const PORT = process.env.PORT || 3030
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
})
