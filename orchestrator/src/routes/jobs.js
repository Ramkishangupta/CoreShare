const express = require('express');
const { body, validationResult } = require('express-validator');
const authenticateToken = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// Dockerfile validation function
function validateDockerfile(content) {
  // Check size (100KB max)
  if (content.length > 100000) {
    throw new Error('Dockerfile too large (max 100KB)');
  }

  // Check for FROM statement
  if (!/^\s*FROM\s+/mi.test(content)) {
    throw new Error('Invalid Dockerfile: missing FROM statement');
  }

  // Blacklist dangerous commands
  const blacklist = [
    { pattern: /curl.*\|.*bash/i, message: 'Piping curl to bash is not allowed' },
    { pattern: /wget.*\|.*sh/i, message: 'Piping wget to shell is not allowed' },
    { pattern: /--privileged/i, message: 'Privileged mode is not allowed' },
    { pattern: /--cap-add/i, message: 'Adding capabilities is not allowed' },
    { pattern: /\/dev\/[a-z]+/i, message: 'Direct device access is not allowed' }
  ];

  for (const { pattern, message } of blacklist) {
    if (pattern.test(content)) {
      throw new Error(`Dockerfile validation failed: ${message}`);
    }
  }

  return true;
}

// Submit new job
router.post('/',
  authenticateToken,
  [
    body('dockerfile').notEmpty(),
    body('resources').optional().isObject(),
    body('resources.gpu').optional().isInt({ min: 0 }),
    body('resources.cpu').optional().isInt({ min: 1 }),
    body('resources.ram').optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { dockerfile, resources = {}, preferredWorkerId } = req.body;
    const userId = req.user.userId;

    try {
      // Validate Dockerfile content
      try {
        validateDockerfile(dockerfile);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }

      // Add job via JobScheduler
      const jobScheduler = req.app.locals.jobScheduler;
      const job = await jobScheduler.addJob({
        userId,
        dockerfile,
        resources: {
          gpu: resources.gpu ?? 0,
          cpu: resources.cpu ?? 1,
          ram: resources.ram ?? 2,
          gpuModel: resources.gpuModel,
          preferredWorkerId: preferredWorkerId
        },
        priority: 0
      });

      res.status(201).json({
        job: {
          id: job.id,
          status: job.status,
          createdAt: job.created_at
        }
      });
    } catch (error) {
      console.error('Job submission error:', error);
      res.status(500).json({ error: 'Failed to submit job' });
    }
  }
);

// Get user's jobs
router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { status, limit = 50, offset = 0 } = req.query;
  const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
  const parsedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);

  try {
    let query;
    const params = [];

    // Use explicit parameter positions instead of concatenation
    if (status) {
      query = 'SELECT * FROM jobs WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4';
      params.push(userId, status, parsedLimit, parsedOffset);
    } else {
      query = 'SELECT * FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params.push(userId, parsedLimit, parsedOffset);
    }

    const result = await db.query(query, params);

    res.json({
      jobs: result.rows.map(job => ({
        id: job.id,
        status: job.status,
        resources: job.resources_requested,
        createdAt: job.created_at,
        startTime: job.start_time,
        endTime: job.end_time
      }))
    });
  } catch (error) {
    console.error('Fetch jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Get specific job details
router.get('/:id', authenticateToken, async (req, res) => {
  const jobId = req.params.id;
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT j.*, b.cost AS billing_cost, w.worker_id AS worker_external_id
       FROM jobs j
       LEFT JOIN billing b ON b.job_id = j.id
       LEFT JOIN workers w ON j.worker_id = w.id
       WHERE j.id = $1 AND j.user_id = $2`,
      [jobId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];
    const workerManager = req.app.locals.workerManager;
    const worker = job.worker_external_id
      ? workerManager.getWorkerByWorkerId(job.worker_external_id)
      : null;
    const pricing = worker?.pricing || {
      gpuPerMinute: parseFloat(process.env.GPU_PRICE_DEFAULT || process.env.GPU_PRICE_PER_MINUTE || 0.10),
      cpuPerMinute: parseFloat(process.env.CPU_PRICE_PER_MINUTE || 0.02)
    };

    res.json({
      job: {
        id: job.id,
        status: job.status,
        dockerfile: job.dockerfile,
        resources: job.resources_requested,
        logs: job.logs,
        result: job.result,
        error: job.error_message,
        billingCost: job.billing_cost !== null ? parseFloat(job.billing_cost) : null,
        pricing,
        createdAt: job.created_at,
        startTime: job.start_time,
        endTime: job.end_time
      }
    });
  } catch (error) {
    console.error('Fetch job error:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// Resubmit job
router.post('/:id/resubmit', authenticateToken, async (req, res) => {
  const jobId = req.params.id;
  const userId = req.user.userId;

  try {
    // Get original job
    const result = await db.query(
      'SELECT * FROM jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const originalJob = result.rows[0];

    // Create new job with same details
    const jobScheduler = req.app.locals.jobScheduler;
    const newJob = await jobScheduler.addJob({
      userId: userId,
      dockerfile: originalJob.dockerfile,
      resources: {
        gpu: originalJob.resources_requested.gpu || 0,
        cpu: originalJob.resources_requested.cpu || 2,
        ram: originalJob.resources_requested.ram || 2,
        gpuModel: originalJob.resources_requested.gpuModel,
        preferredWorkerId: originalJob.resources_requested.preferredWorkerId
      },
      priority: 0
    });

    res.status(201).json({
      job: {
        id: newJob.id,
        status: newJob.status,
        createdAt: newJob.created_at
      }
    });
  } catch (error) {
    console.error('Resubmit job error:', error);
    res.status(500).json({ error: 'Failed to resubmit job' });
  }
});

// Cancel job
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  const jobId = req.params.id;
  const userId = req.user.userId;

  try {
    const result = await db.query(
      'SELECT status FROM jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return res.status(400).json({ error: 'Job already finished' });
    }

    const jobScheduler = req.app.locals.jobScheduler;
    await jobScheduler.cancelJob(jobId);

    res.json({ message: 'Job cancelled successfully' });
  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

module.exports = router;
