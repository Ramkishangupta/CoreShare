# GPU/CPU Allocation Guide

This comprehensive guide explains how the GPU/CPU rental platform handles resource allocation, validates GPU availability, and ensures proper execution of Docker containers with specific hardware requirements.

## 📋 Table of Contents
- [Overview](#overview)
- [Three-Layer Validation System](#three-layer-validation-system)
- [GPU Detection and Initialization](#gpu-detection-and-initialization)
- [Docker GPU Configuration](#docker-gpu-configuration)
- [Resource Allocation Flow](#resource-allocation-flow)
- [Configuration Examples](#configuration-examples)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The platform implements a **three-layer validation system** to ensure that jobs requesting GPU/CPU resources are matched with appropriate workers and executed correctly:

1. **Orchestrator Layer** - Matches jobs with workers based on resource requirements
2. **Worker Layer** - Validates actual hardware availability before accepting jobs
3. **Docker Layer** - Enforces resource limits at the container runtime level

This multi-layer approach prevents jobs from failing due to:
- Workers claiming GPU availability without actually having GPUs
- Incorrect GPU configuration
- Resource conflicts between concurrent jobs
- Missing NVIDIA runtime support

---

## 🔍 Three-Layer Validation System

### Layer 1: Orchestrator-Side Worker Matching

**Location**: `orchestrator/src/services/WorkerManager.js`

**What it does**:
- Maintains registry of all connected workers with their capabilities
- Filters workers based on job requirements (GPU count, CPU cores, RAM)
- Only considers workers that match the resource type (GPU vs CPU)

**Code Flow**:
```javascript
findAvailableWorker(requirements) {
  const workers = Array.from(this.workers.values());
  
  return workers.find(worker => {
    // Worker must be online and available
    if (worker.status !== 'available') return false;
    
    // Match resource type
    if (requirements.gpu > 0 && worker.resources.type !== 'GPU') {
      return false;
    }
    
    // Match GPU count
    if (requirements.gpu > worker.resources.gpuCount) {
      return false;
    }
    
    // Match CPU and RAM requirements
    if (requirements.cpu > worker.resources.cpuCores) return false;
    if (requirements.ram > worker.resources.ram) return false;
    
    return true;
  });
}
```

**Benefits**:
- Fast filtering before job assignment
- Prevents jobs from being sent to incompatible workers
- Load balancing across available workers

---

### Layer 2: Worker-Side Resource Validation

**Location**: `worker/src/services/DockerExecutor.js`

**What it does**:
- Validates GPU availability when worker starts up
- Checks for NVIDIA runtime support in Docker
- Validates resources before executing each job
- Throws errors if GPU is requested but unavailable

#### A. Initialization Check

When a worker starts, it immediately validates GPU support:

```javascript
async initialize() {
  try {
    const info = await this.docker.info();
    
    // Check for NVIDIA runtime
    const hasNvidiaRuntime = info.Runtimes && 
                            (info.Runtimes.nvidia || info.Runtimes['nvidia-container-runtime']);
    
    if (hasNvidiaRuntime) {
      // Detect GPU count using nvidia-smi
      const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader');
      const gpuCount = stdout.trim().split('\n').filter(line => line.trim()).length;
      
      this.gpuAvailable = true;
      this.gpuCount = gpuCount;
      logger.info(`✅ GPU support detected: ${gpuCount} GPU(s) available`);
    } else {
      this.gpuAvailable = false;
      this.gpuCount = 0;
      logger.warn('⚠️  No GPU runtime detected. GPU jobs will fail.');
    }
  } catch (error) {
    this.gpuAvailable = false;
    this.gpuCount = 0;
    logger.error('GPU detection failed:', error);
  }
}
```

**What this prevents**:
- Workers claiming GPU support when Docker isn't configured for GPUs
- Jobs being accepted on workers without NVIDIA Container Toolkit
- Silent failures due to missing GPU drivers

#### B. Pre-Execution Validation

Before running each job, the worker validates resources again:

```javascript
validateResources(gpuCount) {
  if (gpuCount > 0) {
    if (!this.gpuAvailable) {
      throw new Error(
        'GPU requested but no GPU runtime available. ' +
        'Install NVIDIA Container Toolkit and restart worker.'
      );
    }
    
    if (gpuCount > this.gpuCount) {
      throw new Error(
        `Requested ${gpuCount} GPU(s) but only ${this.gpuCount} available`
      );
    }
  }
}
```

**What this prevents**:
- Jobs requesting more GPUs than available
- Race conditions where GPU becomes unavailable
- Execution of GPU jobs without proper runtime

---

### Layer 3: Docker Runtime Enforcement

**Location**: `worker/src/services/DockerExecutor.js` → `runContainer()`

**What it does**:
- Uses Docker's `DeviceRequests` API to allocate specific GPUs
- Sets up NVIDIA runtime and environment variables
- Enforces resource limits (CPU, memory)
- Configures security constraints

#### GPU Allocation Code

```javascript
const containerConfig = {
  Image: imageName,
  Cmd: ['sh', '-c', job.command || 'echo "Job completed"'],
  
  // GPU Configuration
  HostConfig: {
    // GPU Device Request
    DeviceRequests: gpuCount > 0 ? [
      {
        Driver: 'nvidia',              // Use NVIDIA driver
        Count: gpuCount,               // Number of GPUs to allocate
        Capabilities: [['gpu']],       // Enable GPU capabilities
      }
    ] : undefined,
    
    // Resource Limits
    Memory: memoryLimit,               // RAM limit in bytes
    NanoCpus: cpuLimit * 1e9,         // CPU cores (in nano CPUs)
    
    // Security
    NetworkMode: 'none',              // Isolated network
    SecurityOpt: ['no-new-privileges'], // Prevent privilege escalation
    CapDrop: ['ALL'],                 // Drop all capabilities
  },
  
  // Environment Variables for GPU
  Env: gpuCount > 0 ? [
    `NVIDIA_VISIBLE_DEVICES=${Array.from({length: gpuCount}, (_, i) => i).join(',')}`,
    'NVIDIA_DRIVER_CAPABILITIES=compute,utility',
    `CUDA_VISIBLE_DEVICES=${Array.from({length: gpuCount}, (_, i) => i).join(',')}`
  ] : [],
};
```

#### Understanding DeviceRequests

**`DeviceRequests`** is Docker's API for allocating GPUs to containers:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `Driver` | `'nvidia'` | Specifies NVIDIA GPU driver |
| `Count` | Number (e.g., `2`) | How many GPUs to allocate |
| `Capabilities` | `[['gpu']]` | Enables GPU compute capabilities |

**Environment Variables**:

- **`NVIDIA_VISIBLE_DEVICES`**: Comma-separated GPU indices (e.g., `"0,1"` for 2 GPUs)
- **`NVIDIA_DRIVER_CAPABILITIES`**: What the container can do with GPUs (`compute,utility`)
- **`CUDA_VISIBLE_DEVICES`**: CUDA-specific GPU visibility (matches NVIDIA_VISIBLE_DEVICES)

**What this prevents**:
- Containers accessing GPUs they shouldn't
- GPU memory conflicts between concurrent jobs
- Security vulnerabilities from unrestricted access

---

## 🚀 GPU Detection and Initialization

### How Workers Detect GPUs

When a worker starts, it performs these checks:

#### 1. Check Docker Info for NVIDIA Runtime

```bash
# What the code does internally
docker info | grep -i nvidia
```

Looks for:
- `nvidia` in available runtimes
- `nvidia-container-runtime` in runtime list

#### 2. Query GPU Count with nvidia-smi

```bash
# Command executed by worker
nvidia-smi --query-gpu=name --format=csv,noheader

# Example output:
# NVIDIA GeForce RTX 3090
# NVIDIA GeForce RTX 3090
```

Counts lines to determine GPU count.

#### 3. Set Worker Capabilities

Based on detection results:

```javascript
// Success
this.gpuAvailable = true;
this.gpuCount = 2;

// Failure
this.gpuAvailable = false;
this.gpuCount = 0;
```

### Worker Startup Logs

**With GPU Support**:
```
Starting worker agent...
Worker ID: worker-gpu01
Type: GPU
Checking GPU availability...
✅ GPU support detected: 2 GPU(s) available
Connecting to orchestrator...
```

**Without GPU Support**:
```
Starting worker agent...
Worker ID: worker-cpu01
Type: CPU
Checking GPU availability...
⚠️  No GPU runtime detected. GPU jobs will fail.
Connecting to orchestrator...
```

---

## 🐳 Docker GPU Configuration

### Prerequisites for GPU Support

For a worker to support GPU jobs, the following must be installed:

#### 1. NVIDIA Drivers

```bash
# Check if installed
nvidia-smi

# Expected output: GPU information table
```

#### 2. NVIDIA Container Toolkit

**Ubuntu/Debian**:
```bash
# Add repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Configure Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

#### 3. Verify GPU Access from Docker

```bash
# Test GPU access
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi

# Should display your GPU(s)
```

---

## 🔄 Resource Allocation Flow

### Complete Job Execution Flow

```
User Submits Job (2 GPUs, 8 CPUs, 16GB RAM)
           ↓
    ┌──────────────────┐
    │  1. ORCHESTRATOR │
    │  Worker Matching │
    └──────────────────┘
           ↓
    Filter workers:
    - Status = 'available'
    - Type = 'GPU'
    - gpuCount >= 2
    - cpuCores >= 8
    - ram >= 16
           ↓
    Found: worker-gpu01
           ↓
    Assign job to worker
           ↓
    ┌──────────────────┐
    │  2. WORKER       │
    │  Pre-validation  │
    └──────────────────┘
           ↓
    validateResources(2):
    - Check gpuAvailable = true
    - Check gpuCount >= 2
    - Throws error if fail
           ↓
    ┌──────────────────┐
    │  3. DOCKER       │
    │  Container Config│
    └──────────────────┘
           ↓
    Create container with:
    - DeviceRequests: {
        Driver: 'nvidia',
        Count: 2,
        Capabilities: [['gpu']]
      }
    - Memory: 16GB
    - NanoCpus: 8 * 1e9
    - Env: [
        'NVIDIA_VISIBLE_DEVICES=0,1',
        'CUDA_VISIBLE_DEVICES=0,1'
      ]
           ↓
    Container starts with:
    ✅ Access to GPUs 0 and 1
    ✅ 16GB RAM limit
    ✅ 8 CPU cores
    ✅ Isolated network
           ↓
    Job executes successfully
```

---

## ⚙️ Configuration Examples

### Worker Configuration for Different Setups

#### GPU Worker (2x RTX 3090)

**`worker/config.json`**:
```json
{
  "orchestratorUrl": "http://192.168.1.10:3000",
  "workerId": "worker-lab1-gpu01",
  "workerToken": "your-secret-token",
  "resources": {
    "type": "GPU",
    "gpuModel": "NVIDIA RTX 3090",
    "gpuCount": 2,
    "cpuCores": 16,
    "ram": 64,
    "storage": 1000
  },
  "docker": {
    "socketPath": "/var/run/docker.sock",
    "maxConcurrentJobs": 1,
    "defaultTimeout": 3600000,
    "networkMode": "none",
    "memoryLimit": "32g",
    "cpuLimit": 8
  }
}
```

#### CPU-Only Worker

**`worker/config.json`**:
```json
{
  "orchestratorUrl": "http://192.168.1.10:3000",
  "workerId": "worker-lab2-cpu01",
  "workerToken": "your-secret-token",
  "resources": {
    "type": "CPU",
    "gpuCount": 0,
    "cpuCores": 32,
    "ram": 128,
    "storage": 2000
  },
  "docker": {
    "socketPath": "/var/run/docker.sock",
    "maxConcurrentJobs": 4,
    "defaultTimeout": 3600000,
    "networkMode": "none",
    "memoryLimit": "64g",
    "cpuLimit": 16
  }
}
```

### Dockerfile Examples

#### GPU-Enabled Dockerfile (PyTorch)

```dockerfile
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

# Install Python and pip
RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch with CUDA support
RUN pip3 install torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cu118

# Copy training script
COPY train.py /app/train.py
WORKDIR /app

# Verify GPU access and run training
CMD python3 -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('GPU count:', torch.cuda.device_count())" && \
    python3 train.py
```

#### GPU-Enabled Dockerfile (TensorFlow)

```dockerfile
FROM tensorflow/tensorflow:2.13.0-gpu

# Install additional dependencies
RUN pip install --upgrade pip && \
    pip install pandas numpy matplotlib scikit-learn

# Copy application code
COPY . /app
WORKDIR /app

# Run script
CMD ["python", "train_model.py"]
```

#### CPU-Only Dockerfile (Data Processing)

```dockerfile
FROM python:3.11-slim

# Install dependencies
RUN pip install pandas numpy scipy scikit-learn

# Copy data processing script
COPY process_data.py /app/
WORKDIR /app

# Run processing
CMD ["python", "process_data.py"]
```

---

## 🐛 Troubleshooting

### Common Issues and Solutions

#### Issue 1: GPU Job Fails with "No GPU runtime available"

**Symptom**:
```
Error: GPU requested but no GPU runtime available. 
Install NVIDIA Container Toolkit and restart worker.
```

**Cause**: Worker doesn't have NVIDIA Container Toolkit installed

**Solution**:
```bash
# Install NVIDIA Container Toolkit
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Configure Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Restart worker
cd worker
npm run dev
```

#### Issue 2: Worker Reports 0 GPUs Despite Having GPUs

**Symptom**:
```
⚠️  No GPU runtime detected. GPU jobs will fail.
```

**Cause**: 
- NVIDIA drivers not installed
- nvidia-smi not in PATH
- Docker not configured for GPU

**Solution**:
```bash
# Check NVIDIA drivers
nvidia-smi

# If not found, install drivers
sudo apt-get install nvidia-driver-525

# Verify Docker sees NVIDIA runtime
docker info | grep -i nvidia

# Should show: Runtimes: nvidia
```

#### Issue 3: Container Can't Access GPU

**Symptom**:
```
CUDA error: no CUDA-capable device is detected
```

**Cause**: Environment variables not set correctly or DeviceRequests misconfigured

**Debug Steps**:
```bash
# Test GPU access manually
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi

# Check worker logs
tail -f worker/logs/combined.log

# Verify job configuration included GPU count > 0
```

#### Issue 4: Job Exceeds Memory Limit

**Symptom**:
```
Container killed (OOMKilled)
```

**Cause**: Job requested less RAM than needed

**Solution**:
1. Increase RAM in job submission form
2. Optimize code to use less memory
3. Increase worker's default memory limit in config.json

#### Issue 5: Multiple Jobs Fighting for Same GPU

**Symptom**:
- CUDA out of memory errors
- Slow performance
- Random failures

**Cause**: Worker running multiple GPU jobs concurrently

**Solution**:
Set `maxConcurrentJobs: 1` in worker config for GPU workers:

```json
{
  "docker": {
    "maxConcurrentJobs": 1
  }
}
```

---

## 📊 Resource Validation Matrix

| Layer | Check | When | Prevents |
|-------|-------|------|----------|
| **Orchestrator** | Worker has `type: 'GPU'` | Job assignment | Sending GPU jobs to CPU workers |
| **Orchestrator** | Worker `gpuCount >= required` | Job assignment | Over-allocation of GPUs |
| **Worker** | `gpuAvailable === true` | Job execution | Running GPU jobs without runtime |
| **Worker** | `gpuCount >= requested` | Job execution | Requesting unavailable GPUs |
| **Docker** | `DeviceRequests.Count` | Container creation | GPU access violations |
| **Docker** | Environment variables | Container runtime | CUDA detection failures |
| **Docker** | Memory/CPU limits | Container runtime | Resource exhaustion |

---

## 🎯 Best Practices

### For Workers

1. **Always run initialization**: Start worker with `npm run dev` to trigger GPU detection
2. **Set realistic limits**: Configure `maxConcurrentJobs` based on GPU memory
3. **Monitor resources**: Check `nvidia-smi` regularly to verify GPU utilization
4. **Update drivers**: Keep NVIDIA drivers and Container Toolkit up to date

### For Job Submission

1. **Request only what you need**: Don't request 4 GPUs if you only use 1
2. **Test locally first**: Validate Dockerfile with `docker build` before submitting
3. **Set appropriate timeouts**: Long-running jobs need higher timeout values
4. **Monitor costs**: Each GPU minute costs money - optimize your code!

### For Orchestrator Admins

1. **Verify worker registration**: Check worker specs match actual hardware
2. **Monitor worker heartbeats**: Offline workers should be removed from pool
3. **Review billing**: Ensure pricing reflects actual resource costs
4. **Set reasonable defaults**: Configure default memory/CPU limits appropriately

---

## 🔗 Related Documentation

- **[README.md](README.md)** - Project overview and quick start
- **[SETUP.md](SETUP.md)** - Complete installation guide
- **[architecture.html](architecture.html)** - Interactive system diagrams

---

## 📚 Additional Resources

### Official Documentation
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
- [Docker DeviceRequests API](https://docs.docker.com/engine/api/v1.40/#operation/ContainerCreate)
- [CUDA Environment Variables](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#env-vars)

### Useful Commands

```bash
# Check GPU info
nvidia-smi
nvidia-smi -L                    # List GPUs
nvidia-smi --query-gpu=memory.free --format=csv

# Docker GPU tests
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
docker info | grep -i runtime

# Worker debugging
tail -f worker/logs/combined.log
docker ps                        # Check running containers
docker logs <container_id>       # Check container logs
```

---

**Need more help?** Check the [SETUP.md](SETUP.md) troubleshooting section or review worker logs for detailed error messages.
