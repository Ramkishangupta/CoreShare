require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const logger = require('./utils/logger');
const db = require('./db');

// Routes
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const workerRoutes = require('./routes/workers');
const userRoutes = require('./routes/users');

// Services
const WorkerManager = require('./services/WorkerManager');
const JobScheduler = require('./services/JobScheduler');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://192.168.223.15:3001',
    credentials: true
  }
});

// Validate JWT_SECRET on startup
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  logger.error('❌ FATAL: JWT_SECRET must be set and at least 32 characters long');
  logger.error('Set JWT_SECRET in your .env file');
  process.exit(1);
}

// Validate WORKER_SECRET_TOKEN on startup
if (!process.env.WORKER_SECRET_TOKEN) {
  logger.error('❌ FATAL: WORKER_SECRET_TOKEN must be set');
  logger.error('Set WORKER_SECRET_TOKEN in your .env file');
  process.exit(1);
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const workerManager = new WorkerManager(io);
const jobScheduler = new JobScheduler(workerManager);

// Make services available to routes
app.locals.workerManager = workerManager;
app.locals.jobScheduler = jobScheduler;
app.locals.io = io;

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', require('./routes/stats'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    workers: workerManager.getWorkerCount(),
    timestamp: new Date().toISOString()
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Worker connection
  socket.on('worker:register', async (data) => {
    try {
      await workerManager.registerWorker(socket, data);
      logger.info(`Worker registered: ${data.workerId}`);
    } catch (error) {
      logger.error('Worker registration failed:', error);
      socket.emit('error', { message: 'Registration failed' });
    }
  });

  // Worker heartbeat
  socket.on('worker:heartbeat', (data) => {
    workerManager.updateHeartbeat(socket.id, data);
  });

  // Job status updates from worker
  socket.on('job:status', async (data) => {
    try {
      await jobScheduler.updateJobStatus(data);
      // Broadcast to user clients
      io.emit(`job:${data.jobId}:status`, data);
    } catch (error) {
      logger.error('Job status update failed:', error);
    }
  });

  // Job completion from worker
  socket.on('job:complete', async (data) => {
    try {
      logger.info(`Received job:complete event for job ${data.jobId}`);
      await jobScheduler.handleJobCompletion(data);
      io.emit(`job:${data.jobId}:complete`, data);
      logger.info(`Emitted job:${data.jobId}:complete to all connected clients`);
    } catch (error) {
      logger.error('Job completion handling failed:', error);
    }
  });

  socket.on('disconnect', () => {
    workerManager.handleDisconnect(socket.id);
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Start scheduler
jobScheduler.start();

// Error handling
// Sanitize errors to prevent information leakage
app.use((err, req, res, next) => {
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    path: req.path
  });

  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    error: 'Internal server error',
    // Only include message in development, never stack trace
    ...(isDev && { message: err.message })
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  logger.info(`🚀 Orchestrator server running on http://${HOST}:${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);

  // Display network URLs
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  logger.info('Network URLs:');
  Object.keys(networkInterfaces).forEach(interfaceName => {
    networkInterfaces[interfaceName].forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal) {
        logger.info(`  - http://${iface.address}:${PORT}`);
      }
    });
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    jobScheduler.stop();
    db.pool.end();
    process.exit(0);
  });
});
