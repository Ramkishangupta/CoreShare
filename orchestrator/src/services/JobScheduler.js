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

  // Get GPU price per minute based on model (Fallback if worker doesn't specify pricing)
  getGPUPrice(gpuModel) {
    if (!gpuModel || gpuModel.trim() === '') {
      return parseFloat(process.env.GPU_PRICE_DEFAULT || process.env.GPU_PRICE_PER_MINUTE || 0.10);
    }
    
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

  // Get CPU price per minute (Fallback if worker doesn't specify pricing)
  getCPUPrice() {
    return parseFloat(process.env.CPU_PRICE_PER_MINUTE || 0.02);
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
      const assigned = await this.workerManager.assignJobToWorker(worker, jobData);

      if (!assigned) {
        throw new Error('Failed to assign job to worker');
      }

      // Update job status in database
      try {
        await db.query(
          `UPDATE jobs 
           SET status = 'running', 
               worker_id = (SELECT id FROM workers WHERE worker_id = $1),
               resources_requested = resources_requested || jsonb_build_object(
                 'assignedWorkerId', $1,
                 'pricingSnapshot', jsonb_build_object(
                   'gpuPerMinute', $3,
                   'cpuPerMinute', $4
                 )
               ),
               start_time = NOW()
           WHERE id = $2`,
          [
            worker.workerId,
            jobData.id,
            worker.pricing?.gpuPerMinute ?? this.getGPUPrice(jobData.resources_requested?.gpuModel),
            worker.pricing?.cpuPerMinute ?? this.getCPUPrice()
          ]
        );
      } catch (dbError) {
        // Assignment already accepted by worker; try to cancel remote run and unlock worker.
        this.workerManager.cancelJobOnWorker(worker.workerId, jobData.id);
        this.workerManager.releaseWorker(worker.workerId, jobData.id);
        throw dbError;
      }

      return { jobId: jobData.id, workerId: worker.workerId };
    });

    // Queue event handlers
    this.jobQueue.on('completed', (job, result) => {
      logger.info(`Job ${result.jobId} completed on worker ${result.workerId}`);
    });

    this.jobQueue.on('failed', (job, err) => {
      logger.error(`Job ${job.data.id} failed:`, err.message);

      const attemptsAllowed = job?.opts?.attempts || 1;
      if (job.attemptsMade >= attemptsAllowed) {
        db.query(
          `UPDATE jobs
           SET status = 'failed',
               end_time = NOW(),
               error_message = $2
           WHERE id = $1
             AND status IN ('queued', 'running')`,
          [job.data.id, err.message || 'Dispatch failed']
        ).catch(updateErr => logger.error(`Failed to mark job ${job.data.id} as failed:`, updateErr));
      }
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

    // Workers may only report non-terminal running updates; terminal states come from completion flow.
    const normalizedStatus = status === 'running' ? 'running' : null;

    // Don't update status if job is already in a terminal state
    // This prevents race conditions where late status updates overwrite completion
    await db.query(
      `UPDATE jobs 
       SET status = COALESCE($1, status), 
           logs = COALESCE(logs, '') || $2,
           updated_at = NOW()
       WHERE id = $3 AND status NOT IN ('completed', 'failed', 'cancelled')`,
      [normalizedStatus, this.sanitizeText(logs) || '', jobId]
    );

    logger.debug(`Job ${jobId} status update attempted with status ${status}`);
  }

  async handleJobCompletion(data) {
    const { jobId, workerId, success, result, error } = data;

    logger.info(`handleJobCompletion called for job ${jobId}: success=${success}`);
    const client = await db.pool.connect();
    let job;
    try {
      await client.query('BEGIN');

      // Idempotency guard: only allow first terminal transition.
      const updateResult = await client.query(
        `UPDATE jobs 
         SET status = $1,
             end_time = NOW(),
             result = $2,
             error_message = $3
         WHERE id = $4
           AND status NOT IN ('completed', 'failed', 'cancelled')
         RETURNING *`,
        [
          success ? 'completed' : 'failed',
          result || null,
          this.sanitizeText(error) || null,
          jobId
        ]
      );

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        logger.warn(`Ignoring duplicate or stale completion event for job ${jobId}`);
        return;
      }

      logger.info(`Job ${jobId} database update result: ${updateResult.rowCount} rows affected, new status: ${updateResult.rows[0]?.status}`);
      job = updateResult.rows[0];

      if (success) {
        // Calculate cost
        const startTime = new Date(job.start_time);
        const endTime = new Date(job.end_time);
        const durationMinutes = Math.ceil((endTime - startTime) / 60000);

        // Validate duration is reasonable
        if (durationMinutes > 10080) { // 1 week
          logger.warn(`Abnormally long job duration: ${durationMinutes} minutes for job ${jobId}`);
        }

        const requestedResources = job.resources_requested || {};
        const effectiveResources = result?.effectiveResources || null;
        const resources = effectiveResources
          ? {
              ...requestedResources,
              ...effectiveResources
            }
          : requestedResources;
        
        // Pricing resolution order: immutable pricing snapshot -> worker runtime pricing -> env fallback.
        const pricingSnapshot = resources.pricingSnapshot || {};
        const worker = this.workerManager.getWorkerByWorkerId(workerId);
        const pricing = Object.keys(pricingSnapshot).length > 0
          ? pricingSnapshot
          : (worker?.pricing || {});
        
        // Calculate GPU cost
        let gpuCost = 0;
        if (resources.gpu && resources.gpu > 0) {
          const gpuModel = resources.gpuModel || '';
          // Properly check if gpuPerMinute is defined (respects 0)
          const pricePerMinute = pricing.gpuPerMinute !== undefined 
            ? pricing.gpuPerMinute 
            : this.getGPUPrice(gpuModel);
            
          gpuCost = resources.gpu * durationMinutes * pricePerMinute;
          logger.info(`GPU billing: ${resources.gpu}x ${gpuModel || 'Generic'} @ $${pricePerMinute}/min = $${gpuCost.toFixed(2)}`);
        }
        
        const cpuPricePerMinute = pricing.cpuPerMinute !== undefined 
          ? pricing.cpuPerMinute 
          : this.getCPUPrice();
          
        const cpuCost = (resources.cpu || 0) * durationMinutes * cpuPricePerMinute;
        const totalCost = gpuCost + cpuCost;

        // Validate cost is reasonable
        if (totalCost > 1000000 || totalCost < 0 || !isFinite(totalCost)) {
          logger.error(`Invalid billing cost: ${totalCost} for job ${jobId}`);
          throw new Error('Billing calculation error');
        }

        // Insert billing record only once per job.
        const existingBilling = await client.query(
          'SELECT id FROM billing WHERE job_id = $1 LIMIT 1',
          [jobId]
        );

        if (existingBilling.rowCount === 0) {
          await client.query(
            `INSERT INTO billing (user_id, job_id, cost, duration_minutes, resources_used)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (job_id) DO NOTHING`,
            [job.user_id, jobId, totalCost, durationMinutes, JSON.stringify(resources)]
          );


        } else {
          logger.warn(`Billing already exists for job ${jobId}, skipping duplicate billing`);
        }

        logger.info(`Job ${jobId} completed. Cost: $${totalCost.toFixed(2)}, Duration: ${durationMinutes}min`);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Billing/completion transaction failed for job ${jobId}:`, err);
      throw err;
    } finally {
      client.release();
      // Always release worker lock even if completion processing fails.
      this.workerManager.releaseWorker(workerId, jobId, job);
    }
  }

  async cancelJob(jobId) {
    const currentJob = await db.query(
      `SELECT j.status, w.worker_id AS assigned_worker_id
       FROM jobs j
       LEFT JOIN workers w ON j.worker_id = w.id
       WHERE j.id = $1`,
      [jobId]
    );

    if (currentJob.rows[0]?.status === 'running' && currentJob.rows[0]?.assigned_worker_id) {
      this.workerManager.cancelJobOnWorker(currentJob.rows[0].assigned_worker_id, jobId);
    }

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

  async canAcceptWorkerEvent(jobId, workerId, allowUnassigned = false) {
    const result = await db.query(
      `SELECT status, resources_requested->>'assignedWorkerId' AS assigned_worker_id
       FROM jobs
       WHERE id = $1`,
      [jobId]
    );

    if (result.rowCount === 0) {
      return false;
    }

    const jobStatus = result.rows[0]?.status;
    if (['completed', 'failed', 'cancelled'].includes(jobStatus)) {
      return false;
    }

    const assignedWorkerId = result.rows[0]?.assigned_worker_id || null;
    if (!assignedWorkerId) {
      return allowUnassigned && jobStatus === 'queued';
    }

    return assignedWorkerId === workerId;
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
