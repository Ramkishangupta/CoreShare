# Worker Configuration Guide

This directory contains configuration files for different worker types: CPU, GPU, and HYBRID.

## 🆕 Worker Types

### GPU Worker

Dedicated GPU machine for GPU-intensive jobs (ML training, rendering, etc.)

### CPU Worker

CPU-only machine for general compute tasks

### HYBRID Worker (NEW!)

**Single machine serving BOTH GPU and CPU jobs simultaneously!**

- Runs GPU and CPU jobs concurrently
- Resource reservation prevents conflicts
- Better hardware utilization
- Appears as 2 separate workers in UI

## Configuration Files

### `config.gpu.example.json`

Template for GPU workers with NVIDIA GPUs.

**Key Features:**

- `type: "GPU"` - GPU-only worker
- `gpuModel` - GPU model name (e.g., "NVIDIA RTX 4090")
- `gpuCount` - Number of GPUs (check with `nvidia-smi`)
- Worker-provided pricing

### `config.cpu.example.json`

Template for CPU-only workers.

**Key Features:**

- `type: "CPU"` - CPU-only worker
- `gpuCount: 0` - No GPUs
- `cpuCores` - Number of CPU cores
- Higher `maxConcurrentJobs` possible

### `config.hybrid.example.json` (NEW!)

Template for HYBRID workers (dual-mode).

**Key Features:**

- `type: "HYBRID"` - Dual-mode worker
- Separate `gpu` object with `model` and `count`
- `reservation` object defines GPU mode resources
- Pricing for both GPU and CPU modes

**Example:**

```json
{
  "resources": {
    "type": "HYBRID",
    "gpu": {
      "model": "NVIDIA RTX 4090",
      "count": 2
    },
    "cpuCores": 16,
    "ram": 64,
    "reservation": {
      "gpuModeCPU": 4,
      "gpuModeRAM": 32
    }
  }
}
```

This creates:

- **GPU Mode**: 2 GPUs + 4 CPU + 32GB RAM
- **CPU Mode**: 12 CPU + 32GB RAM (remaining resources)

### `config.json`

Your active configuration file (not tracked in git).

```bash
# For GPU worker
cp config.gpu.example.json config.json

# For CPU worker
cp config.cpu.example.json config.json

# For HYBRID worker (NEW!)
cp config.hybrid.example.json config.json
```

Then edit `config.json` with your specific values.

## Important Configuration Fields

### `orchestratorUrl` ⚠️ MUST CHANGE

Set to your orchestrator server's IP address:

- Local: `http://localhost:3000`
- Network: `http://192.168.1.100:3000` (replace with your server IP)

**Find your server IP:**

- Windows: `ipconfig`
- Linux: `hostname -I` or `ip addr`

### `workerId` ⚠️ MUST BE UNIQUE

Each worker needs a unique identifier:

- Format: `worker-<location>-<type><number>`
- Examples:
  - `worker-lab1-gpu01`
  - `worker-server2-cpu03`
  - `worker-hybrid-01` (for HYBRID)

### `workerToken` ⚠️ MUST MATCH

Must be identical to `WORKER_SECRET_TOKEN` in orchestrator's `.env`:

- Default: `worker-token-change-this-to-something-secure`
- **Change to a secure random string**
- Same token for all workers

### `resources`

Set based on your machine's actual hardware:

**For GPU/CPU Workers:**

```json
{
  "type": "GPU", // or "CPU"
  "gpuModel": "NVIDIA RTX 4090",
  "gpuCount": 2,
  "cpuCores": 16,
  "ram": 64,
  "storage": 500
}
```

**For HYBRID Workers:**

```json
{
  "type": "HYBRID",
  "gpu": {
    "model": "NVIDIA RTX 4090",
    "count": 2
  },
  "cpuCores": 16,
  "ram": 64,
  "storage": 500,
  "reservation": {
    "gpuModeCPU": 4, // CPUs reserved for GPU mode
    "gpuModeRAM": 32 // RAM reserved for GPU mode (GB)
  }
}
```

**Check Your Hardware:**

- CPU cores: `nproc` (Linux) or Task Manager (Windows)
- RAM: Available RAM in GB
- GPUs: `nvidia-smi` (GPU workers only)

**HYBRID Reservation Rules:**

- `gpuModeCPU` must be < `cpuCores`
- `gpuModeRAM` must be < `ram`
- CPU mode gets remaining: `cpuCores - gpuModeCPU`
- Example: 16 total CPUs, 4 reserved → 12 available for CPU mode

### `pricing` (NEW!)

**Workers now set their own pricing!**

```json
{
  "pricing": {
    "gpuPerMinute": 0.15, // Price per GPU per minute
    "cpuPerMinute": 0.02 // Price per CPU core per minute
  }
}
```

**Pricing Guidelines:**

- **High-end GPUs** (RTX 4090): $0.12-$0.15/min
- **Mid-range GPUs** (RTX 3090): $0.08-$0.12/min
- **Budget GPUs** (RTX 3050): $0.05-$0.08/min
- **CPU cores**: $0.01-$0.03/min

Users see exact pricing before job submission!

### `docker`

Docker configuration settings:

```json
{
  "docker": {
    "socketPath": "/var/run/docker.sock", // Auto-detected
    "maxConcurrentJobs": 1, // GPU: 1, CPU: 2-4, HYBRID: 2
    "memoryLimit": "16g",
    "cpuLimit": 8,
    "networkMode": "none", // Security: no internet
    "defaultTimeout": 3600000,
    "pruneIntervalMinutes": 30,
    "imageRetentionMinutes": 60
  }
}
```

**Important Settings:**

- `maxConcurrentJobs`:
  - GPU workers: 1 (GPUs don't multitask well)
  - CPU workers: 2-4 (depending on cores)
  - **HYBRID workers: 2** (1 GPU job + 1 CPU job)
- `networkMode: "none"` - Security best practice (no internet access in containers)

- `memoryLimit` - Max memory per container (e.g., "16g", "32g")

- `cpuLimit` - Max CPU cores per container

**Docker Image Cleanup:**

Automatic cleanup to prevent disk exhaustion:

1. **On startup**: Removes all leftover `job-*` images
2. **After each job**: Removes job's Docker image immediately
3. **Periodic cleanup**: Every 30 minutes, removes:
   - Images older than 60 minutes
   - Dangling images
   - Unused containers

Customize cleanup:

```json
{
  "pruneIntervalMinutes": 30, // Run cleanup every 30 min
  "imageRetentionMinutes": 60 // Keep images for 60 min
}
```

## Quick Start

### 1. Copy Example Config

```bash
# GPU worker
cp config.gpu.example.json config.json

# CPU worker
cp config.cpu.example.json config.json

# HYBRID worker (NEW!)
cp config.hybrid.example.json config.json
```

### 2. Edit Required Fields

**Minimum Required Changes:**

- ✅ `orchestratorUrl` - Your orchestrator's IP
- ✅ `workerId` - Unique name for this worker
- ✅ `workerToken` - Match orchestrator's token
- ✅ `resources` - Your machine's specs
- ✅ `pricing` - Your desired rates

### 3. For GPU/HYBRID Workers Only

**Verify GPU:**

```bash
nvidia-smi  # Should show your GPUs
```

**Test Docker GPU Support:**

```bash
docker run --gpus all nvidia/cuda:11.0-base nvidia-smi
```

If this fails, install NVIDIA Container Toolkit:

- [Installation Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

### 4. Start Worker

```bash
npm run dev
```

**Expected Output:**

```
[INFO] Starting worker agent...
[INFO] Worker ID: worker-hybrid-01
[INFO] Type: HYBRID
[INFO] GPUs detected: 2x NVIDIA RTX 4090
[INFO] Connecting to orchestrator at http://192.168.1.10:3000...
[INFO] Connected to orchestrator
[INFO] Registering with orchestrator...
[INFO] Registration confirmed by orchestrator
[INFO] HYBRID worker initialized: GPU mode (2x NVIDIA RTX 4090, 4 CPU), CPU mode (12 CPU)
```

## HYBRID Worker Setup (Detailed)

### Resource Planning

**Example Machine:**

- 2x NVIDIA RTX 4090
- 16 CPU cores
- 64GB RAM

**Reservation Strategy:**

**Option 1: Balanced**

```json
{
  "reservation": {
    "gpuModeCPU": 4,
    "gpuModeRAM": 32
  }
}
```

Result: GPU mode (4 CPU, 32GB) + CPU mode (12 CPU, 32GB)

**Option 2: GPU-Heavy**

```json
{
  "reservation": {
    "gpuModeCPU": 8,
    "gpuModeRAM": 48
  }
}
```

Result: GPU mode (8 CPU, 48GB) + CPU mode (8 CPU, 16GB)

**Option 3: CPU-Heavy**

```json
{
  "reservation": {
    "gpuModeCPU": 2,
    "gpuModeRAM": 16
  }
}
```

Result: GPU mode (2 CPU, 16GB) + CPU mode (14 CPU, 48GB)

### Validation

System validates on registration:

- ✅ `gpu.model` must be set
- ✅ `gpu.count` must be set
- ✅ `gpuModeCPU` must be < `cpuCores`
- ✅ `gpuModeRAM` must be < `ram`
- ✅ `cpuCores` and `ram` must be set

**Invalid config example:**

```json
{
  "cpuCores": 16,
  "reservation": {
    "gpuModeCPU": 20 // ❌ ERROR: 20 > 16
  }
}
```

## Troubleshooting

### Worker won't connect

**Symptoms:**

```
[ERROR] Connection error (attempt 1): connect ECONNREFUSED
```

**Solutions:**

1. Check `orchestratorUrl` is correct
2. Verify orchestrator is running (`npm run dev` in orchestrator/)
3. Ping orchestrator: `ping 192.168.1.100`
4. Check firewall allows port 3000
5. On same machine? Use `http://localhost:3000`

### Invalid token error

**Symptoms:**

```
[ERROR] Registration failed: Invalid worker token
```

**Solutions:**

1. Check `workerToken` in `config.json`
2. Check `WORKER_SECRET_TOKEN` in `orchestrator/.env`
3. Ensure they match exactly (no extra spaces)
4. Case-sensitive!

### GPU not detected

**Symptoms:**

```
[WARN] No NVIDIA GPUs detected
```

**Solutions:**

1. Run `nvidia-smi` - should show GPUs
2. Install/update NVIDIA drivers
3. Install NVIDIA Container Toolkit
4. Restart Docker: `sudo systemctl restart docker`
5. Test: `docker run --gpus all nvidia/cuda:11.0-base nvidia-smi`

### HYBRID worker registration fails

**Symptoms:**

```
[ERROR] HYBRID worker worker-hybrid-01 missing required gpu configuration
```

**Solutions:**

1. Check `gpu.model` is set
2. Check `gpu.count` is set
3. Verify `reservation.gpuModeCPU` < `cpuCores`
4. Verify `reservation.gpuModeRAM` < `ram`
5. See orchestrator logs for detailed error

### Docker connection failed

**Symptoms:**

```
[ERROR] Failed to connect to Docker daemon
```

**Solutions:**

1. Check Docker is running: `docker ps`
2. Verify socket path is correct
3. **Linux**: Add user to docker group:
   ```bash
   sudo usermod -aG docker $USER
   # Then logout and login
   ```
4. **Windows**: Ensure Docker Desktop is running

## Platform-Specific Notes

### Windows

**Docker Socket:**

```json
{
  "docker": {
    "socketPath": "//./pipe/docker_engine"
  }
}
```

**Requirements:**

- Docker Desktop installed
- WSL2 backend for GPU support
- NVIDIA GPU support in WSL2

### Linux

**Docker Socket:**

```json
{
  "docker": {
    "socketPath": "/var/run/docker.sock"
  }
}
```

**User Permissions:**

```bash
sudo usermod -aG docker $USER
```

**Auto-start with systemd:**

```bash
sudo systemctl enable docker
# Create worker service (see SETUP.md)
```

## Advanced Configuration

### Environment Variables

Override config via environment:

```bash
ORCHESTRATOR_URL=http://192.168.1.10:3000 npm run dev
```

### Multiple Workers on Same Machine

Run multiple worker instances:

```bash
# Terminal 1 - GPU worker
CONFIG_PATH=./config.gpu1.json npm run dev

# Terminal 2 - GPU worker
CONFIG_PATH=./config.gpu2.json npm run dev
```

Each needs unique `workerId`!

### Production Deployment

Use PM2 for process management:

```bash
npm install -g pm2
pm2 start src/index.js --name worker-gpu-01
pm2 save
pm2 startup  # Auto-start on boot
```

## Monitoring

### Check Worker Status

**Logs:**

```bash
tail -f logs/combined.log
```

**Docker Images:**

```bash
docker images | grep job-
```

**Resource Usage:**

```bash
nvidia-smi  # GPU usage
htop        # CPU/RAM usage
df -h       # Disk space
```

### Performance Tuning

**For GPU Workers:**

- Set `maxConcurrentJobs: 1`
- Allocate sufficient CPU for GPU jobs
- Monitor GPU memory with `nvidia-smi`

**For CPU Workers:**

- Set `maxConcurrentJobs: 2-4`
- Leave some CPU for system
- Monitor with `htop`

**For HYBRID Workers:**

- Set `maxConcurrentJobs: 2`
- Carefully balance reservation
- Monitor both GPU and CPU utilization
- Adjust reservation based on actual usage

## See Also

- [Main README](../README.md) - Project overview
- [SETUP.md](../SETUP.md) - Complete setup instructions
- [system_validation.md](../brain/.../system_validation.md) - System test results

---

**Questions?** Check the troubleshooting section or orchestrator logs for detailed error messages!
