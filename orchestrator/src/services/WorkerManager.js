const logger = require('../utils/logger');

class WorkerManager {
  constructor(io) {
    this.configa = {
      WORKER_SECRET_TOKEN: 'fndsfnkj@'
    }
    this.io = io;
    this.workers = new Map(); // socketId -> worker data
    this.workersByWorkerId = new Map(); // workerId -> worker data

    // Store interval reference for cleanup
    this.heartbeatInterval = null;

    // Start heartbeat monitor
    this.startHeartbeatMonitor();
  }

  async registerWorker(socket, workerData) {
    const { workerId, type, specs, token } = workerData;

    // Validate worker token
    if (token !== this.configa.WORKER_SECRET_TOKEN) {
      throw new Error('Invalid worker token');
    }

    // Check if worker already exists
    const existingWorker = this.workersByWorkerId.get(workerId);
    if (existingWorker) {
      // Update socket connection
      this.workers.delete(existingWorker.socketId);
    }

    const worker = {
      workerId,
      socketId: socket.id,
      type,
      specs,
      status: 'idle',
      currentJobs: [],
      lastHeartbeat: Date.now(),
      connectedAt: Date.now()
    };

    this.workers.set(socket.id, worker);
    this.workersByWorkerId.set(workerId, worker);

    // Save to database
    const db = require('../db');
    await db.query(
      `INSERT INTO workers (worker_id, type, specs, status, socket_id, last_heartbeat)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (worker_id) 
       DO UPDATE SET 
         socket_id = $5,
         status = 'idle',
         last_heartbeat = NOW(),
         specs = $3`,
      [workerId, type, specs, 'idle', socket.id]
    );

    socket.emit('registered', { success: true, workerId });
    logger.info(`Worker registered: ${workerId} (${type})`);

    return worker;
  }

  updateHeartbeat(socketId, data) {
    const worker = this.workers.get(socketId);
    if (worker) {
      worker.lastHeartbeat = Date.now();
      worker.metrics = data.metrics || {};

      // Update database asynchronously
      const db = require('../db');
      db.query(
        'UPDATE workers SET last_heartbeat = NOW() WHERE worker_id = $1',
        [worker.workerId]
      ).catch(err => logger.error('Failed to update heartbeat:', err));
    }
  }

  handleDisconnect(socketId) {
    const worker = this.workers.get(socketId);
    if (worker) {
      // Fail all running jobs when worker disconnects
      if (worker.currentJobs && worker.currentJobs.length > 0) {
        logger.warn(`Worker ${worker.workerId} disconnected with ${worker.currentJobs.length} running jobs`);

        const db = require('../db');
        for (const jobId of worker.currentJobs) {
          db.query(
            `UPDATE jobs 
             SET status = 'failed', 
                 end_time = NOW(),
                 error_message = 'Worker disconnected unexpectedly'
             WHERE id = $1 AND status = 'running'`,
            [jobId]
          ).catch(err => logger.error(`Failed to fail orphaned job ${jobId}:`, err));
        }
      }

      worker.status = 'offline';
      this.workersByWorkerId.delete(worker.workerId);
      this.workers.delete(socketId);

      // Update database
      const db = require('../db');
      db.query(
        'UPDATE workers SET status = $1, socket_id = NULL WHERE worker_id = $2',
        ['offline', worker.workerId]
      ).catch(err => logger.error('Failed to update worker status:', err));

      logger.info(`Worker disconnected: ${worker.workerId}`);
    }
  }

  startHeartbeatMonitor() {
    // Store interval reference to prevent memory leak
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 120000; // 2 minutes

      this.workers.forEach((worker, socketId) => {
        if (now - worker.lastHeartbeat > timeout) {
          logger.warn(`Worker ${worker.workerId} heartbeat timeout`);
          this.handleDisconnect(socketId);
        }
      });
    }, 30000); // Check every 30 seconds
  }

  // Add cleanup method
  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.info('Worker manager cleanup completed');
    }
  }

  findAvailableWorker(requirements) {
    const { gpu, cpu, ram } = requirements;

    const availableWorkers = Array.from(this.workers.values())
      .filter(w => {
        if (w.status !== 'idle') return false;

        // Check GPU requirements
        if (gpu && gpu > 0) {
          if (w.type !== 'GPU') return false;
          if ((w.specs.gpuCount || 0) < gpu) return false;
        }

        // Check CPU requirements
        if (cpu && (w.specs.cpuCores || 0) < cpu) return false;

        // Check RAM requirements
        if (ram && (w.specs.ram || 0) < ram) return false;

        return true;
      });

    if (availableWorkers.length === 0) return null;

    // Select worker with lowest current load
    return availableWorkers.sort((a, b) =>
      (a.currentJobs?.length || 0) - (b.currentJobs?.length || 0)
    )[0];
  }

  assignJobToWorker(worker, job) {
    worker.status = 'busy';
    worker.currentJobs.push(job.id);

    const socket = this.io.sockets.sockets.get(worker.socketId);
    if (socket) {
      socket.emit('job:new', {
        jobId: job.id,
        dockerfile: job.dockerfile,
        resources: job.resources_requested
      });

      logger.info(`Job ${job.id} assigned to worker ${worker.workerId}`);
      return true;
    }

    return false;
  }

  releaseWorker(workerId, jobId) {
    const worker = this.workersByWorkerId.get(workerId);
    if (worker) {
      worker.currentJobs = worker.currentJobs.filter(id => id !== jobId);
      if (worker.currentJobs.length === 0) {
        worker.status = 'idle';
      }
    }
  }

  getWorkerCount() {
    return {
      total: this.workers.size,
      idle: Array.from(this.workers.values()).filter(w => w.status === 'idle').length,
      busy: Array.from(this.workers.values()).filter(w => w.status === 'busy').length
    };
  }

  getAllWorkers() {
    return Array.from(this.workers.values());
  }

  getWorkerByWorkerId(workerId) {
    return this.workersByWorkerId.get(workerId);
  }
}

module.exports = WorkerManager;
