# GPU/CPU Rental Platform - Complete Setup Guide

This guide will walk you through setting up the entire GPU/CPU rental platform from scratch.

## 📋 Table of Contents
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Orchestrator Setup](#orchestrator-setup)
- [Worker Setup](#worker-setup)
- [Frontend Setup](#frontend-setup)
- [Network Configuration](#network-configuration)
- [Testing](#testing)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## 🔧 Prerequisites

### Required Software

#### On All Machines:
- **Node.js 18+** - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)

#### On Orchestrator Server:
- **PostgreSQL 14+** - [Download](https://www.postgresql.org/download/)
- **Redis** - [Download](https://redis.io/download/)

#### On Worker Machines:
- **Docker** - [Download](https://docs.docker.com/get-docker/)

#### On GPU Workers (Additional):
- **NVIDIA Drivers** - Latest stable version
- **NVIDIA Container Toolkit** - For GPU support in Docker

### Hardware Requirements

#### Orchestrator Server:
- CPU: 4+ cores
- RAM: 8GB+ 
- Disk: 20GB+

#### Worker Machines:
- **GPU Worker**: Any machine with NVIDIA GPU(s)
- **CPU Worker**: Any machine with available CPU cores

---

## 📦 Installation

### 1. Clone Repository

```bash
cd c:\Users\hp\Desktop
git clone <your-repo-url> pbl
cd pbl
```

### 2. Install Dependencies

```bash
# Install root workspace dependencies
npm install

# This will automatically install dependencies for:
# - orchestrator
# - worker  
# - frontend
```

---

## 🎛️ Orchestrator Setup

The orchestrator is the central server that manages everything.

### 1. Install PostgreSQL

#### Windows:
```bash
# Download from https://www.postgresql.org/download/windows/
# Run installer and set password for 'postgres' user
```

#### Linux (Ubuntu/Debian):
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Create Database

```bash
# Windows (Command Prompt as postgres user)
psql -U postgres
CREATE DATABASE gpu_rental;
\q

# Linux
sudo -u postgres psql
CREATE DATABASE gpu_rental;
\q
```

### 3. Install Redis

#### Windows:
```bash
# Download from https://github.com/microsoftarchive/redis/releases
# Or use WSL and install Linux version
```

#### Linux (Ubuntu/Debian):
```bash
sudo apt-get install redis-server
sudo systemctl start redis
sudo systemctl enable redis

# Test Redis
redis-cli ping
# Should return: PONG
```

### 4. Configure Orchestrator

```bash
cd orchestrator
cp .env.example .env
```

#### Edit `.env` file:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
# Format: postgresql://username:password@host:port/database
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/gpu_rental

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
# IMPORTANT: Change this to a random secure string in production!
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# Worker Authentication
# IMPORTANT: Change this and use the same value in all worker configs!
WORKER_SECRET_TOKEN=your-worker-secret-token-change-this

# Pricing Configuration (per minute)
GPU_PRICE_PER_MINUTE=0.10
CPU_PRICE_PER_MINUTE=0.02

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3001
```

### 5. Run Database Migrations

```bash
cd orchestrator
npm run db:migrate
```

Expected output:
```
Starting database migration...
✅ Database migration completed successfully
```

### 6. Start Orchestrator

```bash
npm run dev
```

Expected output:
```
🚀 Orchestrator server running on port 3000
Environment: development
```

**Keep this terminal running!**

---

## 🖥️ Worker Setup

Set up worker agents on each GPU/CPU machine you want to add to the platform.

### 1. Install Docker

#### Windows:
- Download Docker Desktop: https://www.docker.com/products/docker-desktop
- Install and restart
- Verify: `docker --version`

#### Linux (Ubuntu/Debian):
```bash
sudo apt-get update
sudo apt-get install docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
# Logout and login again

# Verify
docker --version
docker ps
```

### 2. GPU Worker Setup (For machines with NVIDIA GPUs)

#### Install NVIDIA Drivers

```bash
# Check if drivers are installed
nvidia-smi

# If not installed:
# Ubuntu/Debian
sudo apt-get install nvidia-driver-525

# Verify
nvidia-smi
# Should show your GPU(s)
```

#### Install NVIDIA Container Toolkit

```bash
# Ubuntu/Debian
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Configure Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

#### Verify GPU Support

```bash
# Test GPU access from Docker
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi

# Should display your GPU(s)
```

### 3. Configure Worker

```bash
cd worker
cp config.example.json config.json
```

#### Edit `config.json`:

**For GPU Worker:**
```json
{
  "orchestratorUrl": "http://192.168.1.10:3000",
  "workerId": "worker-lab1-gpu01",
  "workerToken": "your-worker-secret-token-change-this",
  "resources": {
    "type": "GPU",
    "gpuModel": "NVIDIA RTX 3090",
    "gpuCount": 2,
    "cpuCores": 16,
    "ram": 64,
    "storage": 500
  },
  "docker": {
    "socketPath": "/var/run/docker.sock",
    "maxConcurrentJobs": 1,
    "defaultTimeout": 3600000,
    "networkMode": "none",
    "memoryLimit": "16g",
    "cpuLimit": 8
  },
  "heartbeatInterval": 30000,
  "logLevel": "info"
}
```

**For CPU-only Worker:**
```json
{
  "orchestratorUrl": "http://192.168.1.10:3000",
  "workerId": "worker-lab2-cpu01",
  "workerToken": "your-worker-secret-token-change-this",
  "resources": {
    "type": "CPU",
    "gpuCount": 0,
    "cpuCores": 32,
    "ram": 128,
    "storage": 1000
  },
  "docker": {
    "socketPath": "/var/run/docker.sock",
    "maxConcurrentJobs": 2,
    "defaultTimeout": 3600000,
    "networkMode": "none",
    "memoryLimit": "32g",
    "cpuLimit": 16
  },
  "heartbeatInterval": 30000,
  "logLevel": "info"
}
```

**Important Configuration Notes:**

- `orchestratorUrl`: Replace `192.168.1.10` with your orchestrator server's IP address
- `workerId`: Must be unique for each worker
- `workerToken`: Must match `WORKER_SECRET_TOKEN` in orchestrator's `.env`
- `gpuCount`: Set to actual number of GPUs (use `nvidia-smi` to check)
- `cpuCores`, `ram`: Set based on your machine's actual specs

### 4. Start Worker

```bash
npm run dev
```

Expected output:
```
Starting worker agent...
Worker ID: worker-lab1-gpu01
Type: GPU
✅ GPU support detected: 2 GPU(s) available
Connecting to orchestrator at http://192.168.1.10:3000...
Connected to orchestrator
Registration confirmed by orchestrator
```

**Keep this terminal running!**

### 5. Add More Workers

Repeat steps 1-4 on each additional machine, making sure to:
- Use a unique `workerId` for each worker
- Set correct `orchestratorUrl` pointing to orchestrator server
- Configure `resources` based on each machine's hardware

---

## 🌐 Frontend Setup

### 1. Configure Frontend

```bash
cd frontend
cp .env.local.example .env.local
```

#### Edit `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_WS_URL=http://localhost:3000
```

**For production/remote access:**
```env
NEXT_PUBLIC_API_URL=http://192.168.1.10:3000/api
NEXT_PUBLIC_WS_URL=http://192.168.1.10:3000
```

### 2. Start Frontend

```bash
npm run dev
```

Expected output:
```
ready - started server on 0.0.0.0:3001
```

### 3. Access the Platform

Open your browser and navigate to:
```
http://localhost:3001
```

You should see the landing page!

---

## 🔗 Network Configuration

### Same LAN Setup (College Lab - Recommended)

All machines on the same local network.

#### 1. Find Orchestrator IP

**Windows:**
```bash
ipconfig
# Look for IPv4 Address under your network adapter
# Example: 192.168.1.10
```

**Linux:**
```bash
ip addr
# or
ifconfig
# Look for inet address
# Example: 192.168.1.10
```

#### 2. Update Worker Configurations

On each worker machine, edit `worker/config.json`:

```json
{
  "orchestratorUrl": "http://192.168.1.10:3000"
}
```

#### 3. Update Frontend (if accessing from other machines)

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://192.168.1.10:3000/api
NEXT_PUBLIC_WS_URL=http://192.168.1.10:3000
```

#### 4. Firewall Configuration

Ensure port 3000 is open on orchestrator machine:

**Windows Firewall:**
```bash
# Run as Administrator
netsh advfirewall firewall add rule name="GPU Platform" dir=in action=allow protocol=TCP localport=3000
```

**Linux (UFW):**
```bash
sudo ufw allow 3000/tcp
```

---

## 🧪 Testing

### 1. Create Test Account

1. Open http://localhost:3001
2. Click "Get Started" or "Sign Up"
3. Fill in registration form:
   - Name: Test User
   - Email: test@example.com
   - Password: password123
4. Click "Sign Up"

### 2. Submit Test Job

#### Example 1: Simple Hello World (CPU)

**Dockerfile:**
```dockerfile
FROM ubuntu:latest

CMD ["echo", "Hello from GPU Cloud!"]
```

**Resources:**
- GPU: 0
- CPU: 2
- RAM: 2GB

#### Example 2: Python Script (CPU)

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

RUN pip install numpy pandas

RUN echo 'import numpy as np; print("NumPy version:", np.__version__); print("Random numbers:", np.random.rand(5))' > /app/test.py

CMD ["python", "/app/test.py"]
```

**Resources:**
- GPU: 0
- CPU: 4
- RAM: 4GB

#### Example 3: GPU Test (Requires GPU Worker)

**Dockerfile:**
```dockerfile
FROM nvidia/cuda:11.0-base

CMD ["nvidia-smi"]
```

**Resources:**
- GPU: 1
- CPU: 2
- RAM: 4GB

### 3. Monitor Job Execution

1. Go to "My Jobs" tab
2. Watch job status change: queued → running → completed
3. Click "View Details" to see logs
4. Verify billing was calculated correctly

---

## 🚀 Production Deployment

### Orchestrator as System Service

#### Linux (systemd):

Create service file:
```bash
sudo nano /etc/systemd/system/gpu-orchestrator.service
```

```ini
[Unit]
Description=GPU Rental Platform Orchestrator
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/pbl/orchestrator
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gpu-orchestrator
sudo systemctl start gpu-orchestrator
sudo systemctl status gpu-orchestrator
```

### Worker as System Service

```bash
sudo nano /etc/systemd/system/gpu-worker.service
```

```ini
[Unit]
Description=GPU Worker Agent
After=network.target docker.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/pbl/worker
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gpu-worker
sudo systemctl start gpu-worker
sudo systemctl status gpu-worker
```

### Frontend Production Build

```bash
cd frontend
npm run build
npm start
# Or deploy to Vercel/Netlify
```

---

## 🐛 Troubleshooting

### Orchestrator Issues

#### PostgreSQL Connection Failed
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution:**
1. Check PostgreSQL is running: `pg_isready`
2. Verify credentials in `.env`
3. Test connection: `psql -U postgres -d gpu_rental`

#### Redis Connection Failed
```
Error: Redis connection to localhost:6379 failed
```

**Solution:**
1. Check Redis is running: `redis-cli ping` (should return PONG)
2. Start Redis: `sudo systemctl start redis` (Linux) or `redis-server` (Windows)

#### Migration Failed
```
Error: relation "users" does not exist
```

**Solution:**
```bash
cd orchestrator
rm -rf node_modules
npm install
npm run db:migrate
```

### Worker Issues

#### Worker Won't Connect
```
Connection error: Error: connect ECONNREFUSED
```

**Solution:**
1. Verify orchestrator is running
2. Check `orchestratorUrl` in `config.json` is correct
3. Test connectivity: `ping 192.168.1.10`
4. Check firewall allows port 3000

#### Invalid Token Error
```
Socket error: Invalid worker token
```

**Solution:**
1. Ensure `workerToken` in `worker/config.json` matches `WORKER_SECRET_TOKEN` in `orchestrator/.env`
2. Restart both orchestrator and worker

#### GPU Not Detected
```
No GPU runtime detected. GPU jobs will fail.
```

**Solution:**
1. Verify NVIDIA drivers: `nvidia-smi`
2. Check Docker GPU support: `docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi`
3. Install NVIDIA Container Toolkit if missing
4. Restart Docker: `sudo systemctl restart docker`
5. Restart worker

#### Docker Socket Permission Denied
```
Error: connect EACCES /var/run/docker.sock
```

**Solution (Linux):**
```bash
sudo usermod -aG docker $USER
# Logout and login again
```

### Frontend Issues

#### Can't Connect to API
```
Network Error: ERR_CONNECTION_REFUSED
```

**Solution:**
1. Verify orchestrator is running on port 3000
2. Check `NEXT_PUBLIC_API_URL` in `.env.local`
3. Ensure CORS is configured correctly

#### WebSocket Connection Failed
```
WebSocket connection failed
```

**Solution:**
1. Check `NEXT_PUBLIC_WS_URL` in `.env.local`
2. Verify Socket.io server is running (part of orchestrator)

### Job Execution Issues

#### Job Stuck in "Queued"
**Cause:** No available workers

**Solution:**
1. Check workers are connected: Look at orchestrator logs
2. Verify worker status in dashboard
3. Check worker meets job requirements (GPU count, etc.)

#### Job Failed - Docker Build Error
**Cause:** Invalid Dockerfile

**Solution:**
1. Test Dockerfile locally: `docker build -t test .`
2. Check job logs for specific error
3. Verify base image is accessible

#### Container Killed (OOMKilled)
**Cause:** Container exceeded memory limit

**Solution:**
1. Request more RAM in job submission
2. Optimize code to use less memory
3. Increase worker's memory limits in `config.json`

---

## ✅ Verification Checklist

- [ ] PostgreSQL running and database created
- [ ] Redis running
- [ ] Orchestrator starts without errors
- [ ] Worker connects to orchestrator successfully
- [ ] Frontend loads at localhost:3001
- [ ] Can create user account
- [ ] Can login successfully
- [ ] Can submit test job
- [ ] Job shows in "My Jobs"
- [ ] Worker picks up and executes job
- [ ] Job completes successfully
- [ ] Billing is calculated correctly
- [ ] Credits are deducted from user account

---

## 📊 Monitoring

### View Logs

**Orchestrator:**
```bash
cd orchestrator
tail -f logs/combined.log        # All logs
tail -f logs/error.log           # Errors only
```

**Worker:**
```bash
cd worker
tail -f logs/combined.log
```

### Check System Status

**Database:**
```bash
psql -U postgres -d gpu_rental -c "SELECT COUNT(*) FROM jobs;"
psql -U postgres -d gpu_rental -c "SELECT COUNT(*) FROM workers;"
```

**Redis:**
```bash
redis-cli
> INFO
> KEYS *
```

**Workers:**
```bash
# Check orchestrator health endpoint
curl http://localhost:3000/health
```

---

## 🎯 Next Steps

After successful setup:

1. **Customize Pricing**: Edit GPU/CPU prices in `orchestrator/.env`
2. **Add More Workers**: Scale by adding more GPU/CPU machines
3. **Configure Backups**: Set up PostgreSQL and Redis backups
4. **Set Up Monitoring**: Add Prometheus/Grafana for metrics
5. **Enable HTTPS**: Use Nginx with SSL certificates
6. **User Management**: Create admin accounts for management

---

## 📚 Additional Resources

- [README.md](README.md) - Project overview
- [GPU_ALLOCATION_GUIDE.md](GPU_ALLOCATION_GUIDE.md) - GPU/CPU allocation details
- [architecture.html](architecture.html) - System architecture diagrams

---

## 🆘 Getting Help

If you encounter issues:

1. Check logs in `orchestrator/logs/` and `worker/logs/`
2. Review this troubleshooting section
3. Verify all prerequisites are installed
4. Ensure all configuration files are correct
5. Test each component individually

---

**You're all set! Happy computing! 🚀**
