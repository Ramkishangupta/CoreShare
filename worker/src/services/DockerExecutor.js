const Docker = require('dockerode');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

class DockerExecutor {
  constructor(config = {}) {
    this.config = config;
    this.docker = new Docker({
      socketPath: config.socketPath || '/var/run/docker.sock'
    });
    this.runningContainers = new Map(); // jobId -> container
    this.hasGpuSupport = false;
    this.availableGpus = 0;
  }

  /**
   * Initialize and check GPU availability
   */
  async initialize() {
    try {
      // Check Docker version and GPU runtime
      const info = await this.docker.info();

      // Check if NVIDIA runtime is available
      if (info.Runtimes && (info.Runtimes.nvidia || info.Runtimes['nvidia-container-runtime'])) {
        this.hasGpuSupport = true;

        // Try to detect GPU count
        try {
          // This works if nvidia-smi is available
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);

          const { stdout } = await execAsync('nvidia-smi --query-gpu=count --format=csv,noheader');
          this.availableGpus = stdout.trim().split('\n').length;
          logger.info(`GPU support detected: ${this.availableGpus} GPU(s) available`);
        } catch (error) {
          logger.warn('Could not detect GPU count, assuming GPU support exists');
          this.availableGpus = 1; // Assume at least 1 GPU if runtime exists
        }
      } else {
        logger.info('No GPU runtime detected. GPU jobs will fail.');
      }

      logger.info(`Docker initialized. GPU support: ${this.hasGpuSupport}`);
    } catch (error) {
      logger.error('Failed to initialize Docker executor:', error);
      throw error;
    }
  }

  async executeDockerfile(dockerfileContent, options) {
    const { jobId, resources, onLog } = options;

    // Validate resources before starting
    this.validateResources(resources, onLog);

    const buildContext = await this.prepareBuildContext(dockerfileContent, jobId);

    try {
      // Build image
      onLog && onLog('[BUILD] Building Docker image...\n');
      const imageName = `job-${jobId}:latest`;
      await this.buildImage(buildContext, imageName, onLog);

      // Run container
      onLog && onLog('[RUN] Starting container...\n');
      const result = await this.runContainer(imageName, jobId, resources, onLog);

      // Cleanup
      await this.cleanup(imageName, buildContext);

      return result;
    } catch (error) {
      await this.cleanup(null, buildContext);
      throw error;
    }
  }

  async prepareBuildContext(dockerfileContent, jobId) {
    // Create temporary directory for build context
    const contextDir = path.join(os.tmpdir(), `docker-build-${jobId}`);
    await fs.mkdir(contextDir, { recursive: true });

    // Write Dockerfile
    const dockerfilePath = path.join(contextDir, 'Dockerfile');
    await fs.writeFile(dockerfilePath, dockerfileContent);

    logger.debug(`Build context prepared at ${contextDir}`);
    return contextDir;
  }

  async buildImage(contextDir, imageName, onLog) {
    return new Promise(async (resolve, reject) => {
      try {
        const tarStream = await this.createTarStream(contextDir);

        const stream = await this.docker.buildImage(tarStream, {
          t: imageName,
          rm: true, // Remove intermediate containers
          forcerm: true, // Always remove intermediate containers
          nocache: false
        });

        this.docker.modem.followProgress(
          stream,
          (err, output) => {
            if (err) {
              logger.error('Image build failed:', err);
              reject(err);
            } else {
              logger.info(`Image ${imageName} built successfully`);
              resolve(output);
            }
          },
          (event) => {
            // Stream build output
            if (event.stream) {
              onLog && onLog(event.stream);
              logger.debug(event.stream.trim());
            }
            if (event.error) {
              logger.error('Build error:', event.error);
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async createTarStream(contextDir) {
    const tar = require('tar');
    const { Readable } = require('stream');

    return tar.create(
      {
        gzip: true,
        cwd: contextDir
      },
      ['.']
    );
  }

  /**
   * Validate that requested resources are available
   */
  validateResources(resources, onLog) {
    // Check GPU requirements
    if (resources.gpu && resources.gpu > 0) {
      if (!this.hasGpuSupport) {
        const error = `GPU requested (${resources.gpu}) but no GPU runtime available on this worker`;
        logger.error(error);
        onLog && onLog(`[ERROR] ${error}\n`);
        throw new Error(error);
      }

      if (resources.gpu > this.availableGpus) {
        const error = `Requested ${resources.gpu} GPU(s) but only ${this.availableGpus} available`;
        logger.error(error);
        onLog && onLog(`[ERROR] ${error}\n`);
        throw new Error(error);
      }

      logger.info(`GPU validation passed: ${resources.gpu} GPU(s) will be allocated`);
      onLog && onLog(`[INFO] Allocating ${resources.gpu} GPU(s)\n`);
    } else {
      logger.info('CPU-only job, no GPU allocation');
      onLog && onLog('[INFO] Running on CPU only\n');
    }

    // Log resource allocation
    onLog && onLog(`[RESOURCES] CPU: ${resources.cpu} cores, RAM: ${resources.ram}GB${resources.gpu ? `, GPU: ${resources.gpu}` : ''}\n`);
  }

  async runContainer(imageName, jobId, resources, onLog) {
    return new Promise(async (resolve, reject) => {
      try {
        // Container configuration
        const containerConfig = {
          Image: imageName,
          name: `job-${jobId}`,
          HostConfig: {
            Memory: this.parseMemory(resources.ram || this.config.memoryLimit),
            NanoCpus: (resources.cpu || this.config.cpuLimit) * 1e9,
            NetworkMode: this.config.networkMode || 'none',
            AutoRemove: true,

            // GPU allocation (if requested and available)
            ...(resources.gpu && resources.gpu > 0 && this.hasGpuSupport && {
              DeviceRequests: [{
                Driver: 'nvidia',
                Count: resources.gpu,
                Capabilities: [['gpu', 'compute', 'utility']],
                Options: {}
              }]
            }),

            // Additional security constraints
            SecurityOpt: ['no-new-privileges:true'],
            ReadonlyRootfs: false, // Set to true for extra security if app allows
            CapDrop: ['ALL'],
            CapAdd: ['CHOWN', 'SETUID', 'SETGID'] // Minimal capabilities
          },

          // Environment variables for GPU (if applicable)
          Env: resources.gpu && resources.gpu > 0 ? [
            'NVIDIA_VISIBLE_DEVICES=all',
            `NVIDIA_DRIVER_CAPABILITIES=compute,utility`,
            `CUDA_VISIBLE_DEVICES=0${resources.gpu > 1 ? ',' + Array.from({ length: resources.gpu - 1 }, (_, i) => i + 1).join(',') : ''}`
          ] : [],
          Tty: false,
          AttachStdout: true,
          AttachStderr: true
        };

        // Create container
        const container = await this.docker.createContainer(containerConfig);
        this.runningContainers.set(jobId, container);

        // Attach to container output
        const stream = await container.attach({
          stream: true,
          stdout: true,
          stderr: true
        });

        let output = '';
        stream.on('data', (chunk) => {
          const data = chunk.toString().replace(/\u0000/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
          output += data;
          onLog && onLog(data);
        });

        // Start container
        await container.start();
        logger.info(`Container started for job ${jobId}`);

        // Wait for container to finish
        const statusCode = await container.wait();

        // Get exit code
        const exitCode = statusCode.StatusCode || 0;

        // Cleanup
        this.runningContainers.delete(jobId);

        logger.info(`Container finished with exit code ${exitCode}`);

        resolve({
          exitCode,
          output: output.substring(0, 10000) // Limit output size
        });

      } catch (error) {
        this.runningContainers.delete(jobId);
        logger.error('Container execution failed:', error);
        reject(error);
      }
    });
  }

  async stopJob(jobId) {
    const container = this.runningContainers.get(jobId);
    if (container) {
      try {
        await container.stop({ t: 10 }); // 10 second grace period
        await container.remove({ force: true });
        this.runningContainers.delete(jobId);
        logger.info(`Job ${jobId} stopped and removed`);
      } catch (error) {
        logger.error(`Failed to stop job ${jobId}:`, error);
        throw error;
      }
    }
  }

  async cleanup(imageName, contextDir) {
    // Remove image
    if (imageName) {
      try {
        const image = this.docker.getImage(imageName);
        await image.remove({ force: true });
        logger.debug(`Image ${imageName} removed`);
      } catch (error) {
        logger.warn(`Failed to remove image ${imageName}:`, error.message);
      }
    }

    // Remove build context
    if (contextDir) {
      try {
        await fs.rm(contextDir, { recursive: true, force: true });
        logger.debug(`Build context ${contextDir} removed`);
      } catch (error) {
        logger.warn(`Failed to remove build context:`, error.message);
      }
    }
  }

  parseMemory(memoryStr) {
    // If a number is provided, treat it as GB (common config uses numbers for GB)
    if (typeof memoryStr === 'number') return memoryStr * 1024 ** 3;

    const units = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    const match = String(memoryStr).toLowerCase().match(/^(\d+)([kmg]?)$/);

    if (!match) return 512 * 1024 * 1024; // Default 512MB

    const [, amount, unit] = match;
    return parseInt(amount, 10) * (units[unit] || 1);
  }
}

module.exports = DockerExecutor;