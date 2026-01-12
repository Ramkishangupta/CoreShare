const os = require('os');
const si = require('systeminformation');
const logger = require('../utils/logger');

class ResourceMonitor {
  constructor() {
    this.gpuInfo = null;
    this.hasGpu = false;
  }

  async initialize() {
    try {
      // Check for GPU
      const graphics = await si.graphics();
      this.hasGpu = graphics.controllers.length > 0;
      if (this.hasGpu) {
        this.gpuInfo = graphics.controllers;
        logger.info('GPU detected:', this.gpuInfo.map(g => g.model).join(', '));
      }
    } catch (error) {
      logger.warn('GPU detection failed:', error.message);
    }
  }

  async getMetrics() {
    try {
      // CPU usage
      const cpuLoad = await si.currentLoad();
      const cpu = cpuLoad.currentLoad;

      // Memory usage
      const mem = await si.mem();
      const memory = {
        used: mem.used,
        total: mem.total,
        percentage: (mem.used / mem.total) * 100
      };

      // GPU usage (if available)
      let gpu = null;
      if (this.hasGpu) {
        try {
          const graphics = await si.graphics();
          gpu = graphics.controllers.map(g => ({
            model: g.model,
            memoryUsed: g.memoryUsed || 0,
            memoryTotal: g.memoryTotal || 0,
            utilizationGpu: g.utilizationGpu || 0
          }));
        } catch (error) {
          logger.debug('GPU metrics unavailable:', error.message);
        }
      }

      return { cpu, memory, gpu };
    } catch (error) {
      logger.error('Failed to get metrics:', error);
      return { cpu: 0, memory: { used: 0, total: 1, percentage: 0 }, gpu: null };
    }
  }

  async getSystemInfo() {
    const cpu = await si.cpu();
    const mem = await si.mem();
    const osInfo = await si.osInfo();

    return {
      cpu: {
        model: cpu.manufacturer + ' ' + cpu.brand,
        cores: cpu.cores,
        speed: cpu.speed
      },
      memory: {
        total: mem.total
      },
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release
      }
    };
  }
}

module.exports = ResourceMonitor;
