const express = require('express');
const authenticateToken = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// Get all workers with pricing and availability
router.get('/', authenticateToken, async (req, res) => {
  try {
    const workerManager = req.app.locals.workerManager;
    const workers = workerManager.getAllWorkers();

    const workerList = [];
    
    workers.forEach(w => {
      if (w.type === 'HYBRID') {
        // HYBRID worker - create TWO entries
        
        // GPU Mode Entry
        workerList.push({
          workerId: w.workerId,
          displayMode: 'GPU',
          type: 'HYBRID',
          specs: {
            gpuModel: w.modes.gpu.specs.gpuModel,
            gpuCount: w.modes.gpu.specs.gpuCount,
            cpuCores: w.modes.gpu.specs.cpuCores,
            ram: w.modes.gpu.specs.ram,
            storage: w.specs.storage || 0
          },
          status: w.modes.gpu.available ? 'idle' : 'busy',
          pricing: {
            gpuPerMinute: w.pricing.gpuPerMinute,
            cpuPerMinute: 0  // Included in GPU price
          },
          availability: {
            currentJobs: w.modes.gpu.currentJobs?.length || 0,
            maxJobs: 1,
            isAvailable: w.modes.gpu.available
          },
          connectedAt: w.connectedAt,
          lastHeartbeat: w.lastHeartbeat
        });
        
        // CPU Mode Entry
        workerList.push({
          workerId: w.workerId,
          displayMode: 'CPU',
          type: 'HYBRID',
          specs: {
            gpuModel: null,
            gpuCount: 0,
            cpuCores: w.modes.cpu.availableCPU,  // Dynamic!
            ram: w.modes.cpu.availableRAM,        // Dynamic!
            storage: w.specs.storage || 0
          },
          status: w.modes.cpu.available ? 'idle' : 'busy',
          pricing: {
            gpuPerMinute: 0,
            cpuPerMinute: w.pricing.cpuPerMinute
          },
          availability: {
            currentJobs: w.modes.cpu.currentJobs?.length || 0,
            maxJobs: 10,  // Can handle multiple CPU jobs
            isAvailable: w.modes.cpu.available && w.modes.cpu.availableCPU > 0
          },
          connectedAt: w.connectedAt,
          lastHeartbeat: w.lastHeartbeat
        });
      } else {
        // Regular GPU or CPU worker - single entry
        workerList.push({
          workerId: w.workerId,
          type: w.type,
          specs: {
            gpuModel: w.specs.gpuModel || null,
            gpuCount: w.specs.gpuCount || 0,
            cpuCores: w.specs.cpuCores || 0,
            ram: w.specs.ram || 0,
            storage: w.specs.storage || 0
          },
          status: w.status,
          pricing: w.pricing || getPricingForWorker(w),
          availability: {
            currentJobs: w.currentJobs?.length || 0,
            maxJobs: 1,
            isAvailable: w.status === 'idle'
          },
          connectedAt: w.connectedAt,
          lastHeartbeat: w.lastHeartbeat
        });
      }
    });

    res.json({ workers: workerList });
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

// Helper: Get pricing for a worker
function getPricingForWorker(worker) {
  const gpuModel = worker.specs?.gpuModel || '';
  
  // Get GPU price from env
  let gpuPerMinute = 0;
  if (gpuModel) {
    const modelKey = gpuModel.replace(/\s+/g, '_').replace(/[^A-Z0-9_]/gi, '').toUpperCase();
    const envKey = `GPU_PRICE_${modelKey}`;
    gpuPerMinute = parseFloat(process.env[envKey] || process.env.GPU_PRICE_DEFAULT || 0.10);
  }
  
  const cpuPerMinute = parseFloat(process.env.CPU_PRICE_PER_MINUTE || 0.02);
  
  return {
    gpuPerMinute,
    cpuPerMinute,
    currency: 'USD'
  };
}

module.exports = router;
