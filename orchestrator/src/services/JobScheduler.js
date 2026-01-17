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

  // Get GPU price per minute based on model
  getGPUPrice(gpuModel) {
    if (!gpuModel || gpuModel.trim() === '') {
      return parseFloat(process.env.GPU_PRICE_DEFAULT || process.env.GPU_PRICE_PER_MINUTE || 0.10);
    }
    
    // Convert GPU model to env var key
    // "NVIDIA RTX 4090" → "GPU_PRICE_NVIDIA_RTX_4090"
    const modelKey = gpuModel
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/gi, '')
      .toUpperCase();
    
    const envKey = `GPU_PRICE_${modelKey}`;
    const price = parseFloat(process.env[envKey] || process.env.GPU_PRICE_DEFAULT || 0.10);
    
    logger.debug(`GPU pricing lookup: ${gpuModel} → ${envKey} = $${price}/min`);
    return price;
  }

  setupQueueHandlers() {
    // Process jobs from queue
    this.jobQueue.process(async (job) => {
      const jobData = job.data;
      logger.info(`Processing job ${jobData.id} from queue`);

      // Re-check credits before execution
      const userResult = await db.query(
        'SELECT credits FROM users WHERE id = $1',
        [jobData.userId]
      );

      if (!userResult.rows[0] || userResult.rows[0].credits <= 0) {
        logger.warn(`Job ${jobData.id} cancelled: insufficient credits at execution time`);
        await db.query(
          `UPDATE jobs SET status = $1, error_message = $2, end_time = NOW() WHERE id = $3`,
          ['failed', 'Insufficient credits at execution time', jobData.id]
        );
        return; // Don't execute job
      }

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

    // Don't update status if job is already in a terminal state
    // This prevents race conditions where late status updates overwrite completion
    await db.query(
      `UPDATE jobs 
       SET status = $1, 
           logs = COALESCE(logs, '') || $2,
           updated_at = NOW()
       WHERE id = $3 AND status NOT IN ('completed', 'failed', 'cancelled')`,
      [status, this.sanitizeText(logs) || '', jobId]
    );

    logger.debug(`Job ${jobId} status update attempted with status ${status}`);
  }

  async handleJobCompletion(data) {
    const { jobId, workerId, success, result, error } = data;

    logger.info(`handleJobCompletion called for job ${jobId}: success=${success}`);

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

    logger.info(`Job ${jobId} database update result: ${updateResult.rowCount} rows affected, new status: ${updateResult.rows[0]?.status}`);

    const job = updateResult.rows[0];

    if (success && job) {
      // Calculate cost
      const startTime = new Date(job.start_time);
      const endTime = new Date(job.end_time);
      const durationMinutes = Math.ceil((endTime - startTime) / 60000);

      // Validate duration is reasonable
      if (durationMinutes > 10080) { // 1 week
        logger.warn(`Abnormally long job duration: ${durationMinutes} minutes for job ${jobId}`);
      }

      const resources = job.resources_requested;
      
      // Get worker pricing (use worker's rates if available)
      const worker = this.workerManager.getWorkerByWorkerId(workerId);
      const workerPricing = worker?.pricing || { gpuPerMinute: 0.10, cpuPerMinute: 0.02 };
      
      // Calculate GPU cost based on worker pricing
      let gpuCost = 0;
      if (resources.gpu && resources.gpu > 0) {
        const gpuModel = resources.gpuModel || '';
        const pricePerMinute = workerPricing.gpuPerMinute || this.getGPUPrice(gpuModel);
        gpuCost = resources.gpu * durationMinutes * pricePerMinute;
        logger.info(`GPU billing: ${resources.gpu}x ${gpuModel || 'Generic'} @ $${pricePerMinute}/min = $${gpuCost.toFixed(2)}`);
      }
      
      const cpuCost = (resources.cpu || 0) * durationMinutes * workerPricing.cpuPerMinute;
      const totalCost = gpuCost + cpuCost;

      // Validate cost is reasonable
      if (totalCost > 1000000 || totalCost < 0 || !isFinite(totalCost)) {
        logger.error(`Invalid billing cost: ${totalCost} for job ${jobId}`);
        throw new Error('Billing calculation error');
      }

      // Use transaction for billing + credit deduction
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Insert billing record
        await client.query(
          `INSERT INTO billing (user_id, job_id, cost, duration_minutes, resources_used)
           VALUES ($1, $2, $3, $4, $5)`,
          [job.user_id, jobId, totalCost, durationMinutes, JSON.stringify(resources)]
        );

        // Deduct from user credits (with validation)
        const creditResult = await client.query(
          'UPDATE users SET credits = credits - $1 WHERE id = $2 RETURNING credits',
          [totalCost, job.user_id]
        );

        // Check for negative credits (race condition check)
        if (creditResult.rows[0] && creditResult.rows[0].credits < 0) {
          logger.error(`User ${job.user_id} has negative credits after job ${jobId}`);
          // Don't fail - allow negative credits but log it
        }

        await client.query('COMMIT');
        logger.info(`Job ${jobId} completed. Cost: $${totalCost.toFixed(2)}, Duration: ${durationMinutes}min`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Billing transaction failed for job ${jobId}:`, err);
        throw err;
      } finally {
        client.release();
      }
    }

    // Release worker - pass job object for HYBRID resource restoration
    this.workerManager.releaseWorker(workerId, jobId, job);
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
