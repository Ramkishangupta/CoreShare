const logger = require('../utils/logger');

class WorkerManager {
  constructor(io) {
    this.io = io;
    this.workers = new Map(); // socketId -> worker data
    this.workersByWorkerId = new Map(); // workerId -> worker data
    this.jobModeTracking = new Map(); // jobId -> mode (for HYBRID workers)
    
    // Load workers from database on startup
    this.loadWorkersFromDatabase();
    
    // Start heartbeat monitor
    this.startHeartbeatMonitor();
  }

  async registerWorker(socket, workerData) {
    const { workerId, type, specs, token, pricing } = workerData;

    // Validate worker token
    if (token !== process.env.WORKER_SECRET_TOKEN) {
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
      pricing: pricing || { gpuPerMinute: 0.10, cpuPerMinute: 0.02 },
      status: 'idle',
      currentJobs: [],
      lastHeartbeat: Date.now(),
      connectedAt: Date.now()
    };

    // Initialize HYBRID worker with dual modes
    if (type === 'HYBRID') {
      // Validate HYBRID configuration
      if (!specs.gpu || !specs.gpu.model || !specs.gpu.count) {
        throw new Error(`HYBRID worker ${workerId} missing required gpu configuration (gpu.model and gpu.count)`);
      }
      if (!specs.cpuCores || !specs.ram) {
        throw new Error(`HYBRID worker ${workerId} missing required resources (cpuCores and ram)`);
      }
      
      const reservation = specs.reservation || { gpuModeCPU: 4, gpuModeRAM: 32 };
      
      // Validate reservation doesn't exceed total resources
      if (reservation.gpuModeCPU >= specs.cpuCores) {
        throw new Error(`HYBRID worker ${workerId}: GPU mode CPU reservation (${reservation.gpuModeCPU}) must be less than total CPU (${specs.cpuCores})`);
      }
      if (reservation.gpuModeRAM >= specs.ram) {
        throw new Error(`HYBRID worker ${workerId}: GPU mode RAM reservation (${reservation.gpuModeRAM}) must be less than total RAM (${specs.ram})`);
      }
      
      worker.modes = {
        gpu: {
          available: true,
          currentJobs: [],
          specs: {
            gpuModel: specs.gpu.model,
            gpuCount: specs.gpu.count,
            cpuCores: reservation.gpuModeCPU,
            ram: reservation.gpuModeRAM
          }
        },
        cpu: {
          available: true,
          currentJobs: [],
          availableCPU: specs.cpuCores - reservation.gpuModeCPU,
          availableRAM: specs.ram - reservation.gpuModeRAM,
          maxCPU: specs.cpuCores - reservation.gpuModeCPU,
          maxRAM: specs.ram - reservation.gpuModeRAM
        }
      };
      logger.info(`HYBRID worker initialized: GPU mode (${specs.gpu.count}x ${specs.gpu.model}, ${reservation.gpuModeCPU} CPU), CPU mode (${worker.modes.cpu.maxCPU} CPU)`);
    }

    this.workers.set(socket.id, worker);
    this.workersByWorkerId.set(workerId, worker);

    // Save to database
    const db = require('../db');
    await db.query(
      `INSERT INTO workers (worker_id, type, specs, status, socket_id, last_heartbeat, is_active)
       VALUES ($1, $2, $3, $4, $5, NOW(), true)
       ON CONFLICT (worker_id) 
       DO UPDATE SET 
         socket_id = $5,
         status = 'idle',
         last_heartbeat = NOW(),
         specs = $3,
         is_active = true`,
      [workerId, type, specs, 'idle', socket.id]
    );

    socket.emit('registered', { success: true, workerId });
    logger.info(`Worker registered: ${workerId} (${type})`);
    
    return worker;
  }

  updateHeartbeat(socketId, data) {
    const worker = this.workers.get(socketId);
    if (worker) {
      const now = Date.now();
      worker.lastHeartbeat = now;
      worker.metrics = data.metrics || {};
      
      // Only update database every 5 minutes to reduce load
      const timeSinceLastDbUpdate = worker.lastDbHeartbeat ? (now - worker.lastDbHeartbeat) : Infinity;
      if (timeSinceLastDbUpdate > 300000) { // 5 minutes
        worker.lastDbHeartbeat = now;
        
        const db = require('../db');
        db.query(
          'UPDATE workers SET last_heartbeat = NOW() WHERE worker_id = $1',
          [worker.workerId]
        ).catch(err => logger.error('Failed to update heartbeat:', err));
      }
    }
  }

  async loadWorkersFromDatabase() {
    const db = require('../db');
    
    try {
      const result = await db.query(
        `SELECT * FROM workers WHERE is_active = true ORDER BY created_at`
      );
      
      if (result.rows.length === 0) {
        logger.info('📋 No workers found in database');
        return;
      }
      
      logger.info(`📋 Found ${result.rows.length} workers in database:`);
      
      result.rows.forEach(worker => {
        const timeSinceLastSeen = worker.last_seen_at 
          ? Date.now() - new Date(worker.last_seen_at).getTime()
          : worker.last_heartbeat
          ? Date.now() - new Date(worker.last_heartbeat).getTime()
          : null;
        
        let status;
        if (worker.status === 'idle' && timeSinceLastSeen && timeSinceLastSeen < 60000) {
          status = '🟢 recently online';
        } else if (worker.status === 'offline') {
          const timeStr = timeSinceLastSeen 
            ? this.formatDuration(timeSinceLastSeen)
            : 'unknown';
          status = `🔴 offline (last seen ${timeStr} ago)`;
        } else {
          status = `⚪ ${worker.status}`;
        }
        
        logger.info(`  - ${worker.worker_id} (${worker.type}): ${status}`);
      });
      
      logger.info('Waiting for workers to reconnect...');
    } catch (error) {
      logger.error('Failed to load workers from database:', error);
    }
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  handleDisconnect(socketId) {
    const worker = this.workers.get(socketId);
    if (worker) {
      worker.status = 'offline';
      this.workersByWorkerId.delete(worker.workerId);
      this.workers.delete(socketId);
      
      // Update database
      const db = require('../db');
      db.query(
        `UPDATE workers 
         SET status = $1, 
             socket_id = NULL,
             last_seen_at = NOW()
         WHERE worker_id = $2`,
        ['offline', worker.workerId]
      ).catch(err => logger.error('Failed to update worker status:', err));
      
      logger.info(`Worker disconnected: ${worker.workerId}`);
    }
  }

  startHeartbeatMonitor() {
    setInterval(() => {
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

  findAvailableWorker(requirements) {
    const { gpu, cpu, ram, gpuModel } = requirements;
    
    logger.debug(`Finding worker for: GPU=${gpu}, CPU=${cpu}, RAM=${ram}, gpuModel="${gpuModel || 'Any'}"`);
    
    const availableWorkers = Array.from(this.workers.values())
      .filter(w => {
        if (w.status !== 'idle') {
          logger.debug(`Worker ${w.workerId} rejected: status=${w.status}`);
          return false;
        }
        
        const isGPUJob = gpu && gpu > 0;
        
        // HYBRID worker handling
        if (w.type === 'HYBRID') {
          if (isGPUJob) {
            // GPU job - check GPU mode
            if (!w.modes.gpu.available) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: GPU mode busy`);
              return false;
            }
            if (w.modes.gpu.specs.gpuCount < gpu) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: needs ${gpu} GPUs but has ${w.modes.gpu.specs.gpuCount}`);
              return false;
            }
            if (gpuModel && gpuModel.trim() !== '' && w.modes.gpu.specs.gpuModel !== gpuModel) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: needs "${gpuModel}" but has "${w.modes.gpu.specs.gpuModel}"`);
              return false;
            }
            if (w.modes.gpu.specs.cpuCores < cpu) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: GPU mode needs ${cpu} CPU but has ${w.modes.gpu.specs.cpuCores}`);
              return false;
            }
            if (w.modes.gpu.specs.ram < ram) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: GPU mode needs ${ram}GB RAM but has ${w.modes.gpu.specs.ram}GB`);
              return false;
            }
            logger.debug(`Worker ${w.workerId} (HYBRID-GPU): All requirements met! ✓`);
            w._selectedMode = 'gpu';  // Tag for assignment
            return true;
          } else {
            // CPU job - check CPU mode
            if (!w.modes.cpu.available) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: CPU mode busy`);
              return false;
            }
            if (w.modes.cpu.availableCPU < cpu) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: CPU mode needs ${cpu} CPU but has ${w.modes.cpu.availableCPU}`);
              return false;
            }
            if (w.modes.cpu.availableRAM < ram) {
              logger.debug(`Worker ${w.workerId} (HYBRID) rejected: CPU mode needs ${ram}GB RAM but has ${w.modes.cpu.availableRAM}GB`);
              return false;
            }
            logger.debug(`Worker ${w.workerId} (HYBRID-CPU): All requirements met! ✓`);
            w._selectedMode = 'cpu';  // Tag for assignment
            return true;
          }
        }
        
        // GPU matching logic for GPU-only workers
        if (isGPUJob) {
          // Job needs GPU - only GPU workers allowed
          if (w.type !== 'GPU') {
            logger.debug(`Worker ${w.workerId} rejected: needs GPU but worker is ${w.type}`);
            return false;
          }
          if ((w.specs.gpuCount || 0) < gpu) {
            logger.debug(`Worker ${w.workerId} rejected: needs ${gpu} GPUs but has ${w.specs.gpuCount}`);
            return false;
          }
          
          // Check specific GPU model if requested
          if (gpuModel && gpuModel.trim() !== '') {
            if (w.specs.gpuModel !== gpuModel) {
              logger.debug(`Worker ${w.workerId} rejected: needs "${gpuModel}" but has "${w.specs.gpuModel}"`);
              return false;
            }
            logger.debug(`Worker ${w.workerId}: GPU model "${gpuModel}" matches! ✓`);
          }
        } else {
          // Job is CPU-only (gpu  = 0 or undefined) - exclude GPU workers
          // GPU workers should be reserved for GPU jobs
          if (w.type === 'GPU') {
            logger.debug(`Worker ${w.workerId} rejected: CPU-only job, GPU workers reserved`);
            return false;
          }
        }
        
        // Check CPU requirements
        if (cpu && (w.specs.cpuCores || 0) < cpu) {
          logger.debug(`Worker ${w.workerId} rejected: needs ${cpu} CPU but has ${w.specs.cpuCores}`);
          return false;
        }
        
        // Check RAM requirements
        if (ram && (w.specs.ram || 0) < ram) {
          logger.debug(`Worker ${w.workerId} rejected: needs ${ram}GB RAM but has ${w.specs.ram}GB`);
          return false;
        }
        
        logger.debug(`Worker ${w.workerId}: All requirements met! ✓`);
        return true;
      });

    if (availableWorkers.length === 0) {
      logger.warn(`No available worker found for requirements: GPU=${gpu}, CPU=${cpu}, RAM=${ram}, gpuModel="${gpuModel || 'Any'}"`);
      return null;
    }

    // Select worker with lowest current load
    const selected = availableWorkers.sort((a, b) => 
      (a.currentJobs?.length || 0) - (b.currentJobs?.length || 0)
    )[0];
    
    const mode = selected._selectedMode || 'default';
    logger.info(`Selected worker: ${selected.workerId} (${selected.type}${mode !== 'default' ? '-' + mode.toUpperCase() : ''}, load: ${selected.currentJobs?.length || 0} jobs)`);
    return selected;
  }

  assignJobToWorker(worker, job) {
    const mode = worker._selectedMode || 'default';
    
    // Track which mode is being used for HYBRID workers
    if (worker.type === 'HYBRID') {
      // Store mode in Map instead of mutating job object (prevents memory leak)
      this.jobModeTracking.set(job.id, mode);
      
      if (mode === 'gpu') {
        worker.modes.gpu.currentJobs.push(job.id);
        worker.modes.gpu.available = false;
        logger.info(`Job ${job.id} assigned to ${worker.workerId} (HYBRID-GPU mode)`);
      } else {
        worker.modes.cpu.currentJobs.push(job.id);
        worker.modes.cpu.availableCPU -= job.resources_requested.cpu || 0;
        worker.modes.cpu.availableRAM -= job.resources_requested.ram || 0;
        worker.modes.cpu.available = worker.modes.cpu.availableCPU > 0;
        logger.info(`Job ${job.id} assigned to ${worker.workerId} (HYBRID-CPU mode, ${worker.modes.cpu.availableCPU} CPU remaining)`);
      }
      
      delete worker._selectedMode;  // Clear temporary flag
    } else {
      // Regular worker logic
      worker.status = 'busy';
    }
    
    worker.currentJobs.push(job.id);
    
    const socket = this.io.sockets.sockets.get(worker.socketId);
    if (socket) {
      socket.emit('job:new', {
        jobId: job.id,
        dockerfile: job.dockerfile,
        resources: job.resources_requested
      });
      
      if (worker.type !== 'HYBRID') {
        logger.info(`Job ${job.id} assigned to worker ${worker.workerId}`);
      }
      return true;
    }
    
    return false;
  }

  releaseWorker(workerId, jobId, job) {
    const worker = this.workersByWorkerId.get(workerId);
    if (worker) {
      worker.currentJobs = worker.currentJobs.filter(id => id !== jobId);
      
      // HYBRID worker resource release
      if (worker.type === 'HYBRID') {
        const mode = this.jobModeTracking.get(jobId);
        
        if (mode === 'gpu') {
          worker.modes.gpu.currentJobs = worker.modes.gpu.currentJobs.filter(id => id !== jobId);
          worker.modes.gpu.available = true;
          logger.info(`Job ${jobId} released from ${workerId} (HYBRID-GPU mode now available)`);
        } else if (mode === 'cpu') {
          worker.modes.cpu.currentJobs = worker.modes.cpu.currentJobs.filter(id => id !== jobId);
          worker.modes.cpu.availableCPU += job?.resources_requested?.cpu || 0;
          worker.modes.cpu.availableRAM += job?.resources_requested?.ram || 0;
          worker.modes.cpu.available = true;
          logger.info(`Job ${jobId} released from ${workerId} (HYBRID-CPU mode, ${worker.modes.cpu.availableCPU} CPU available)`);
        }
        
        // Clean up mode tracking
        this.jobModeTracking.delete(jobId);
      } else {
        // Regular worker
        if (worker.currentJobs.length === 0) {
          worker.status = 'idle';
        }
      }
    } else {
      logger.warn(`Worker ${workerId} not found when releasing job ${jobId} - worker may be offline`);
      // Clean up mode tracking even if worker offline
      this.jobModeTracking.delete(jobId);
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
