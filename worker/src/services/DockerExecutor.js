const Docker = require('dockerode');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

class DockerExecutor {
  constructor(config = {}) {
    this.config = config;

    // Platform detection for Windows/Linux Docker socket
    const getDockerSocketPath = () => {
      if (process.platform === 'win32') {
        return '//./pipe/docker_engine'; // Windows named pipe
      }
      return '/var/run/docker.sock'; // Linux/Mac Unix socket
    };

    this.docker = new Docker({
      socketPath: config.socketPath || getDockerSocketPath()
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
      // Validate Docker connection first
      try {
        await this.docker.ping();
        logger.info('✅ Docker connection successful');
      } catch (dockerError) {
        logger.error('❌ Failed to connect to Docker daemon');
        logger.error(`Socket path: ${this.docker.modem.socketPath || 'default'}`);
        logger.error('Make sure Docker is running and accessible');
        throw new Error(`Docker connection failed: ${dockerError.message}`);
      }

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

          // Fix GPU count detection
          const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader');
          this.availableGpus = stdout.trim().split('\n').filter(line => line).length;
          logger.info(`GPU support detected: ${this.availableGpus} GPU(s) available`);
        } catch (error) {
          logger.warn('Could not detect GPU count, assuming GPU support exists');
          this.availableGpus = 1; // Assume at least 1 GPU if runtime exists
        }
      } else {
        logger.warn('⚠️  NVIDIA runtime not detected - GPU jobs will fail');
        this.hasGpuSupport = false;
        this.availableGpus = 0;
      }

      // Validate worker config against system capabilities
      const systemCPUs = info.NCPU || os.cpus().length;
      const systemMemoryGB = Math.floor((info.MemTotal || os.totalmem()) / (1024 ** 3));

      logger.info(`\n📊 System Resources:`);
      logger.info(`   CPUs: ${systemCPUs} cores`);
      logger.info(`   Memory: ${systemMemoryGB}GB`);
      logger.info(`   GPUs: ${this.availableGpus}`);

      // Validate CPU configuration
      if (this.config.cpuLimit && this.config.cpuLimit > systemCPUs) {
        logger.error(`\n❌ CONFIG ERROR: cpuLimit (${this.config.cpuLimit}) exceeds system CPUs (${systemCPUs})`);
        logger.error(`   Fix: Set cpuLimit to ${systemCPUs} or less in config.json`);
        throw new Error(`Invalid config: cpuLimit ${this.config.cpuLimit} > available CPUs ${systemCPUs}`);
      }

      // Validate memory configuration
      const configMemoryGB = this.parseMemory(this.config.memoryLimit) / (1024 ** 3);
      if (configMemoryGB > systemMemoryGB) {
        logger.error(`\n❌ CONFIG ERROR: memoryLimit (${this.config.memoryLimit}) exceeds system memory (${systemMemoryGB}GB)`);
        logger.error(`   Fix: Set memoryLimit to ${systemMemoryGB}g or less in config.json`);
        throw new Error(`Invalid config: memoryLimit ${this.config.memoryLimit} > available memory ${systemMemoryGB}GB`);
      }

      logger.info(`\n✅ Configuration validated successfully`);
      logger.info(`   CPU Limit: ${this.config.cpuLimit || 'unlimited'}`);
      logger.info(`   Memory Limit: ${this.config.memoryLimit || 'unlimited'}`);

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

      // Check GPU count
      if (resources.gpu > this.availableGpus) {
        const error = `Requested ${resources.gpu} GPU(s) but only ${this.availableGpus} available`;
        logger.error(error);
        onLog && onLog(`[ERROR] ${error}\n`);
        throw new Error(error);
      }

      // Check GPU model if specified in job
      const workerGpuModel = this.config.resources?.gpuModel;
      const requestedGpuModel = resources.gpuModel;
      
      if (requestedGpuModel && requestedGpuModel.trim() !== '') {
        if (!workerGpuModel) {
          logger.warn(`Job requests ${requestedGpuModel} but worker has no gpuModel configured`);
        } else if (workerGpuModel !== requestedGpuModel) {
          const error = `Job requires ${requestedGpuModel} but worker has ${workerGpuModel}`;
          logger.error(error);
          onLog && onLog(`[ERROR] ${error}\n`);
          throw new Error(error);
        } else {
          logger.info(`GPU model validated: ${workerGpuModel} ✓`);
          onLog && onLog(`[INFO] Using GPU: ${workerGpuModel}\n`);
        }
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
        // Validate CPU request against system limits
        const systemInfo = await this.docker.info();
        const systemCPUs = systemInfo.NCPU || os.cpus().length;
        let requestedCPUs = resources.cpu || this.config.cpuLimit || 1;

        if (requestedCPUs > systemCPUs) {
          const errorMsg = `Job ${jobId} requests ${requestedCPUs} CPUs but system only has ${systemCPUs} available. Capping to ${systemCPUs}.`;
          logger.warn(`⚠️  ${errorMsg}`);
          if (onLog) onLog(`[WARNING] ${errorMsg}\n`);
          requestedCPUs = systemCPUs;
        }

        // Container configuration
        const containerConfig = {
          Image: imageName,
          name: `job-${jobId}`,
          HostConfig: {
            Memory: this.parseMemory(resources.ram || this.config.memoryLimit),
            NanoCpus: requestedCPUs * 1e9,  // Using validated CPU count
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

        // Track output truncation
        const MAX_OUTPUT = 10000;
        let output = '';
        let truncated = false;

        stream.on('data', (chunk) => {
          const data = chunk.toString().replace(/\u0000/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');

          // Check if adding this chunk would exceed limit
          if (output.length + data.length > MAX_OUTPUT) {
            if (!truncated) {
              output += data.substring(0, MAX_OUTPUT - output.length);
              output += '\n\n[OUTPUT TRUNCATED - 10KB LIMIT REACHED]';
              truncated = true;
              onLog && onLog('\n\n[OUTPUT TRUNCATED - 10KB LIMIT REACHED]');
            }
          } else {
            output += data;
            onLog && onLog(data);
          }
        });

        // Start container
        await container.start();
        logger.info(`Container started for job ${jobId}`);

        // Add job timeout (1 hour max)
        const MAX_JOB_DURATION = 3600000; // 1 hour in milliseconds

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Job exceeded maximum duration (1 hour)'));
          }, MAX_JOB_DURATION);
        });

        // Wait for container to finish or timeout
        const statusCode = await Promise.race([
          container.wait(),
          timeoutPromise
        ]).catch(async (err) => {
          // Timeout occurred - stop the container
          if (err.message.includes('maximum duration')) {
            logger.warn(`Job ${jobId} exceeded timeout, stopping container`);
            try {
              await container.stop({ t: 5 });
            } catch (stopErr) {
              logger.error('Failed to stop timed-out container:', stopErr);
            }
            throw err;
          }
          throw err;
        });

        // Get exit code
        const exitCode = statusCode.StatusCode || 0;

        // Cleanup
        this.runningContainers.delete(jobId);

        logger.info(`Container finished with exit code ${exitCode}`);

        resolve({
          exitCode,
          output,
          truncated // Include truncation flag
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
    // Remove image with retry logic
    if (imageName) {
      let attempts = 0;
      const maxAttempts = 2;
      
      while (attempts < maxAttempts) {
        try {
          const image = this.docker.getImage(imageName);
          await image.remove({ force: true });
          logger.info(`✓ Image ${imageName} removed successfully`);
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxAttempts) {
            logger.error(`✗ Failed to remove image ${imageName} after ${maxAttempts} attempts:`, error.message);
          } else {
            logger.warn(`Retry ${attempts}/${maxAttempts} for image ${imageName}`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
          }
        }
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

  /**
   * Prune old Docker images to prevent disk space exhaustion
   * Removes: dangling images, old job images (older than 1 hour)
   */
  async pruneOldImages() {
    try {
      logger.info('Starting Docker image cleanup...');
      
      // Get all images
      const images = await this.docker.listImages();
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      let removedCount = 0;
      
      // Remove old job-* images
      for (const imageInfo of images) {
        const tags = imageInfo.RepoTags || [];
        const createdMs = imageInfo.Created * 1000;
        
        // Check if this is a job image and older than 1 hour
        const isJobImage = tags.some(tag => tag.startsWith('job-'));
        if (isJobImage && createdMs < oneHourAgo) {
          try {
            const image = this.docker.getImage(imageInfo.Id);
            await image.remove({ force: true });
            logger.info(`Pruned old image: ${tags[0] || imageInfo.Id.substring(0, 12)}`);
            removedCount++;
          } catch (error) {
            logger.debug(`Could not remove image ${imageInfo.Id.substring(0, 12)}: ${error.message}`);
          }
        }
      }
      
      // Prune dangling images (untagged)
      try {
        const pruneResult = await this.docker.pruneImages({
          filters: { dangling: { true: true } }
        });
        
        if (pruneResult.ImagesDeleted) {
          removedCount += pruneResult.ImagesDeleted.length;
          logger.info(`Pruned ${pruneResult.ImagesDeleted.length} dangling images`);
        }
        
        if (pruneResult.SpaceReclaimed) {
          const mbReclaimed = (pruneResult.SpaceReclaimed / (1024 * 1024)).toFixed(2);
          logger.info(`Space reclaimed: ${mbReclaimed} MB`);
        }
      } catch (error) {
        logger.warn('Failed to prune dangling images:', error.message);
      }
      
      logger.info(`Image cleanup complete. Removed ${removedCount} images.`);
      return removedCount;
    } catch (error) {
      logger.error('Error during image pruning:', error);
      return 0;
    }
  }

  /**
   * Clean up all leftover job images on worker startup
   */
  async cleanupOnStartup() {
    try {
      logger.info('Running startup cleanup for leftover job images...');
      
      const images = await this.docker.listImages();
      let removedCount = 0;
      
      for (const imageInfo of images) {
        const tags = imageInfo.RepoTags || [];
        
        // Check if this is a job image
        const isJobImage = tags.some(tag => tag.startsWith('job-'));
        if (isJobImage) {
          try {
            const image = this.docker.getImage(imageInfo.Id);
            await image.remove({ force: true });
            logger.info(`Removed leftover image: ${tags[0] || imageInfo.Id.substring(0, 12)}`);
            removedCount++;
          } catch (error) {
            logger.debug(`Could not remove image ${imageInfo.Id.substring(0, 12)}: ${error.message}`);
          }
        }
      }
      
      logger.info(`Startup cleanup complete. Removed ${removedCount} leftover images.`);
      return removedCount;
    } catch (error) {
      logger.error('Error during startup cleanup:', error);
      return 0;
    }
  }

  parseMemory(memoryStr) {
    // If a number is provided, treat it as GB (common config uses numbers for GB)
    if (typeof memoryStr === 'number') {
      const bytes = memoryStr * 1024 ** 3;
      logger.info(`Memory limit: ${memoryStr}GB = ${bytes} bytes`);
      // Enforce minimum 6MB required by Docker
      return Math.max(bytes, 6 * 1024 * 1024);
    }

    const units = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    const match = String(memoryStr).toLowerCase().match(/^(\d+)([kmg]?)$/);

    if (!match) {
      logger.warn(`Invalid memory format: ${memoryStr}, using default 512MB`);
      return 512 * 1024 * 1024; // Default 512MB
    }

    const [, amount, unit] = match;
    const bytes = parseInt(amount, 10) * (units[unit] || 1);
    logger.info(`Memory limit: ${memoryStr} = ${bytes} bytes`);
    // Enforce minimum 6MB required by Docker
    return Math.max(bytes, 6 * 1024 * 1024);
  }
}

module.exports = DockerExecutor;