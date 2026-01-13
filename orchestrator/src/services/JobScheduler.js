const Queue = require('bull');
const logger = require('../utils/logger');
const db = require('../db');

class JobScheduler {
  constructor(workerManager) {
    this.workerManager = workerManager;

    // Create Bull queue
    this.jobQueue = new Queue('gpu-jobs', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined
      }
    });

    this.setupQueueHandlers();
  }
  // Remove null bytes and other problematic control characters from log/result strings
  sanitizeText(input) {
    if (!input && input !== '') return input;
    try {
      return String(input).replace(/\u0000/g, '');
    } catch (e) {
      return '';
    }
  }

  setupQueueHandlers() {
    // Process jobs from queue
    this.jobQueue.process(async (job) => {
      const jobData = job.data;
      logger.info(`Processing job ${jobData.id} from queue`);

      // Find available worker
      const worker = this.workerManager.findAvailableWorker(jobData.resources_requested);

      if (!worker) {
        logger.warn(`No available worker for job ${jobData.id}, requeuing`);
        throw new Error('No available worker'); // Will retry
      }

      // Assign job to worker
      const assigned = this.workerManager.assignJobToWorker(worker, jobData);

      if (!assigned) {
        throw new Error('Failed to assign job to worker');
      }

      // Update job status in database
      await db.query(
        `UPDATE jobs 
         SET status = 'running', 
             worker_id = (SELECT id FROM workers WHERE worker_id = $1),
             start_time = NOW()
         WHERE id = $2`,
        [worker.workerId, jobData.id]
      );

      return { jobId: jobData.id, workerId: worker.workerId };
    });

    // Queue event handlers
    this.jobQueue.on('completed', (job, result) => {
      logger.info(`Job ${result.jobId} completed on worker ${result.workerId}`);
    });

    this.jobQueue.on('failed', (job, err) => {
      logger.error(`Job ${job.data.id} failed:`, err.message);
    });
  }

  async addJob(jobData) {
    // Add job to database
    const result = await db.query(
      `INSERT INTO jobs (user_id, dockerfile, status, resources_requested, priority)
       VALUES ($1, $2, 'queued', $3, $4)
       RETURNING *`,
      [
        jobData.userId,
        jobData.dockerfile,
        JSON.stringify(jobData.resources),
        jobData.priority || 0
      ]
    );

    const job = result.rows[0];

    // Add to Bull queue
    await this.jobQueue.add(
      {
        id: job.id,
        userId: job.user_id,
        dockerfile: job.dockerfile,
        resources_requested: job.resources_requested
      },
      {
        priority: job.priority,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    );

    logger.info(`Job ${job.id} added to queue`);
    return job;
  }

  async updateJobStatus(data) {
    const { jobId, status, logs, metrics } = data;

    await db.query(
      `UPDATE jobs 
       SET status = $1, 
           logs = COALESCE(logs, '') || $2,
           updated_at = NOW()
       WHERE id = $3`,
      [status, this.sanitizeText(logs) || '', jobId]
    );

    logger.info(`Job ${jobId} status updated to ${status}`);
  }

  async handleJobCompletion(data) {
    const { jobId, workerId, success, result, error } = data;

    // Update job in database
    const updateResult = await db.query(
      `UPDATE jobs 
       SET status = $1,
           end_time = NOW(),
           result = $2,
           error_message = $3
       WHERE id = $4
       RETURNING *`,
      [
        success ? 'completed' : 'failed',
        result ? this.sanitizeText(JSON.stringify(result)) : null,
        this.sanitizeText(error) || null,
        jobId
      ]
    );

    const job = updateResult.rows[0];

    if (success && job) {
      // Calculate cost
      const startTime = new Date(job.start_time);
      const endTime = new Date(job.end_time);
      const durationMinutes = Math.ceil((endTime - startTime) / 60000);

      const resources = job.resources_requested;
      const gpuCost = (resources.gpu || 0) * durationMinutes * parseFloat(process.env.GPU_PRICE_PER_MINUTE || 0.1);
      const cpuCost = (resources.cpu || 0) * durationMinutes * parseFloat(process.env.CPU_PRICE_PER_MINUTE || 0.02);
      const totalCost = gpuCost + cpuCost;

      // Insert billing record
      await db.query(
        `INSERT INTO billing (user_id, job_id, cost, duration_minutes, resources_used)
         VALUES ($1, $2, $3, $4, $5)`,
        [job.user_id, jobId, totalCost, durationMinutes, JSON.stringify(resources)]
      );

      // Deduct from user credits
      await db.query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [totalCost, job.user_id]
      );

      logger.info(`Job ${jobId} completed. Cost: $${totalCost.toFixed(2)}, Duration: ${durationMinutes}min`);
    }

    // Release worker
    this.workerManager.releaseWorker(workerId, jobId);
  }

  async cancelJob(jobId) {
    await db.query(
      `UPDATE jobs SET status = 'cancelled', end_time = NOW() WHERE id = $1`,
      [jobId]
    );

    // Remove from queue if not started
    const jobs = await this.jobQueue.getJobs(['waiting', 'delayed']);
    const queueJob = jobs.find(j => j.data.id === jobId);
    if (queueJob) {
      await queueJob.remove();
    }

    logger.info(`Job ${jobId} cancelled`);
  }

  async getQueueStatus() {
    const counts = await this.jobQueue.getJobCounts();
    return counts;
  }

  start() {
    logger.info('Job scheduler started');
  }

  async stop() {
    await this.jobQueue.close();
    logger.info('Job scheduler stopped');
  }
}

module.exports = JobScheduler;
