const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const logger = require('./utils/logger');
const DockerExecutor = require('./services/DockerExecutor');
const ResourceMonitor = require('./services/ResourceMonitor');

class WorkerAgent {
  constructor() {
    // Load configuration
    const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../config.json');
    if (!fs.existsSync(configPath)) {
      logger.error('config.json not found! Please create it from config.example.json');
      process.exit(1);
    }

    this.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Log loaded configuration for debugging
    logger.info('Configuration loaded successfully');
    logger.info(`Worker ID: ${this.config.workerId}`);
    logger.info(`Orchestrator URL: ${this.config.orchestratorUrl}`);
    logger.info(`Worker Type: ${this.config.resources.type}`);
    logger.info(`Resources: ${this.config.resources.cpuCores} CPU cores, ${this.config.resources.ram}GB RAM, ${this.config.resources.gpuCount} GPUs`);
    logger.info(`Docker socket: ${this.config.docker.socketPath}`);
    logger.info(`Network mode: ${this.config.docker.networkMode}`);

    this.socket = null;
    this.dockerExecutor = new DockerExecutor(this.config.docker);
    this.resourceMonitor = new ResourceMonitor();
    this.currentJobs = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.shuttingDown = false;
    this.heartbeatInterval = null;
    this.cleanupInterval = null;
  }

  async start() {
    logger.info('Starting worker agent...');
    logger.info(`Worker ID: ${this.config.workerId}`);
    logger.info(`Type: ${this.config.resources.type}`);
    
    // Initialize Docker executor and check GPU availability
    await this.dockerExecutor.initialize();
    
    // Clean up any leftover Docker images from previous runs
    await this.dockerExecutor.cleanupOnStartup();
    
    // Initialize resource monitoring
    await this.resourceMonitor.initialize();
    
    // Connect to orchestrator
    this.connect();

    // Start heartbeat
    this.heartbeatInterval = this.startHeartbeat();

    // Start periodic image cleanup (every 30 minutes)
    this.cleanupInterval = this.startPeriodicCleanup();

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  connect() {
    logger.info(`Connecting to orchestrator at ${this.config.orchestratorUrl}...`);

    this.socket = io(this.config.orchestratorUrl, {
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
      auth: {
        token: this.config.workerToken
      }
    });

    this.socket.on('connect', () => {
      logger.info('Connected to orchestrator');
      this.reconnectAttempts = 0;
      this.register();
    });

    this.socket.on('disconnect', (reason) => {
      logger.warn(`Disconnected from orchestrator: ${reason}`);
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      logger.error(`Connection error (attempt ${this.reconnectAttempts}):`, error.message);
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        logger.error('Max reconnection attempts reached. Exiting...');
        process.exit(1);
      }
    });

    this.socket.on('registered', (data) => {
      logger.info('Registration confirmed by orchestrator');
    });

    this.socket.on('job:new', async (jobData, ack) => {
      logger.info(`Received new job: ${jobData.jobId}`);

      const maxJobs = this.config.docker?.maxConcurrentJobs || 1;
      const alreadyProcessing = this.currentJobs.has(jobData.jobId);
      const atCapacity = this.currentJobs.size >= maxJobs;

      if (typeof ack === 'function') {
        ack({ accepted: !alreadyProcessing && !atCapacity });
      }

      if (alreadyProcessing || atCapacity) {
        logger.warn(`Rejecting job ${jobData.jobId}: ${alreadyProcessing ? 'duplicate' : 'at capacity (${this.currentJobs.size}/${maxJobs})'}`);
        return;
      }

      await this.handleJob(jobData);
    });

    this.socket.on('job:cancel', async (data) => {
      logger.warn(`Job cancellation requested: ${data.jobId}`);
      await this.cancelJob(data.jobId);
    });

    this.socket.on('error', (error) => {
      logger.error('Socket error:', error);
    });
  }

  register() {
    logger.info('Registering with orchestrator...');
    
    this.socket.emit('worker:register', {
      workerId: this.config.workerId,
      type: this.config.resources.type,
      specs: this.config.resources,
      pricing: this.config.pricing || {
        gpuPerMinute: 0.10,
        cpuPerMinute: 0.02
      },
      token: this.config.workerToken
    });
  }

  startHeartbeat() {
    return setInterval(async () => {
      if (this.socket && this.socket.connected) {
        const metrics = await this.resourceMonitor.getMetrics();
        
        this.socket.emit('worker:heartbeat', {
          workerId: this.config.workerId,
          metrics: {
            cpuUsage: metrics.cpu,
            memoryUsage: metrics.memory,
            gpuUsage: metrics.gpu,
            activeJobs: this.currentJobs.size
          }
        });
      }
    }, this.config.heartbeatInterval || 30000);
  }

  startPeriodicCleanup() {
    const intervalMinutes = this.config.docker?.pruneIntervalMinutes || 30;
    const intervalMs = intervalMinutes * 60 * 1000;
    
    logger.info(`Starting periodic image cleanup (every ${intervalMinutes} minutes)`);
    
    return setInterval(async () => {
      logger.info('Running periodic image cleanup...');
      await this.dockerExecutor.pruneOldImages();
    }, intervalMs);
  }

  async handleJob(jobData) {
    const { jobId, dockerfile, resources } = jobData;

    // Check if already processing
    if (this.currentJobs.has(jobId)) {
      logger.warn(`Job ${jobId} already being processed`);
      return;
    }

    this.currentJobs.set(jobId, { status: 'running', startTime: Date.now() });

    try {
      // Notify orchestrator job started
      this.socket.emit('job:status', {
        jobId,
        status: 'running',
        logs: `Job started on worker ${this.config.workerId}\n`
      });

      // Execute Docker container
      const result = await this.dockerExecutor.executeDockerfile(
        dockerfile,
        {
          jobId,
          resources,
          onLog: (log) => {
            // Stream logs to orchestrator
            this.socket.emit('job:status', {
              jobId,
              status: 'running',
              logs: log
            });
          }
        }
      );

      // Job completed successfully
      this.currentJobs.delete(jobId);
      
      this.socket.emit('job:complete', {
        jobId,
        workerId: this.config.workerId,
        success: true,
        result: {
          exitCode: result.exitCode,
          output: result.output
        }
      });

      logger.info(`Job ${jobId} completed successfully`);

    } catch (error) {
      // Job failed
      this.currentJobs.delete(jobId);
      
      logger.error(`Job ${jobId} failed:`, error);
      
      this.socket.emit('job:complete', {
        jobId,
        workerId: this.config.workerId,
        success: false,
        error: error.message
      });
    }
  }

  async cancelJob(jobId) {
    if (!this.currentJobs.has(jobId)) {
      logger.warn(`Job ${jobId} not found for cancellation`);
      return;
    }

    try {
      await this.dockerExecutor.stopJob(jobId);
      this.currentJobs.delete(jobId);
      logger.info(`Job ${jobId} cancelled`);
    } catch (error) {
      logger.error(`Failed to cancel job ${jobId}:`, error);
    }
  }

  async shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info('Shutting down worker agent...');

    // Clear intervals
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    // Cancel all running jobs
    for (const [jobId] of this.currentJobs) {
      await this.cancelJob(jobId);
    }

    // Disconnect from orchestrator
    if (this.socket) {
      this.socket.disconnect();
    }

    process.exit(0);
  }
}

// Start the worker
const worker = new WorkerAgent();
worker.start().catch(error => {
  logger.error('Failed to start worker:', error);
  process.exit(1);
});
