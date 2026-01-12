const express = require('express');
const authenticateToken = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// Get all workers (admin only for now)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const workerManager = req.app.locals.workerManager;
    const workers = workerManager.getAllWorkers();

    res.json({
      workers: workers.map(w => ({
        workerId: w.workerId,
        type: w.type,
        specs: w.specs,
        status: w.status,
        connectedAt: w.connectedAt,
        lastHeartbeat: w.lastHeartbeat
      }))
    });
  } catch (error) {
    console.error('Fetch workers error:', error);
    res.status(500).json({ error: 'Failed to fetch workers' });
  }
});

// Get worker stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const workerManager = req.app.locals.workerManager;
    const counts = workerManager.getWorkerCount();

    res.json(counts);
  } catch (error) {
    console.error('Fetch worker stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
