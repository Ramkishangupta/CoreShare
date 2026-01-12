# GPU/CPU Rental Platform

A distributed platform for renting college GPU/CPU resources to run Docker containers on-demand with usage-based billing.

## 🚀 Overview

This platform enables efficient utilization of underutilized computing resources in college labs by allowing users to submit Docker jobs that execute on distributed GPU/CPU workers. The system handles job queuing, resource allocation, real-time monitoring, and automatic billing.

## 📋 Features

- **🔐 User Authentication**: Secure JWT-based authentication with bcrypt password hashing
- **⚡ Real-time Updates**: WebSocket connections for live job status and log streaming
- **🎯 Smart Resource Allocation**: Automatic worker matching based on GPU/CPU requirements
- **💰 Usage-based Billing**: Per-minute billing for GPU and CPU usage
- **🐳 Docker Native**: Just upload your Dockerfile - we handle the rest
- **🔒 Secure Execution**: Container isolation with resource limits and network restrictions
- **📊 Job Monitoring**: Real-time logs, resource tracking, and billing history
- **🔄 Auto-reconnection**: Workers automatically reconnect with fault tolerance
- **📈 Scalable Queue**: Bull queue with Redis for high throughput

## 🏗️ Architecture

```
┌─────────────┐
│   Frontend  │  (Next.js - Port 3001)
│   (Users)   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│   Orchestrator      │  (Node.js - Port 3000)
│   - API Server      │
│   - Job Queue       │
│   - Worker Manager  │
└──────┬──────────────┘
       │
       ├─────────┬─────────┐
       │         │         │
   ┌───▼───┐ ┌──▼───┐ ┌───▼───┐
   │Worker1│ │Worker│ │Worker3│
   │(GPU)  │ │(GPU)2│ │(CPU)  │
   └───────┘ └──────┘ └───────┘
```

## 💻 Tech Stack

### Frontend
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Socket.io Client** - Real-time communication
- **Axios** - HTTP client

### Backend (Orchestrator)
- **Node.js + Express** - API server
- **Socket.io** - WebSocket server for real-time communication
- **PostgreSQL** - Relational database for users, jobs, billing
- **Redis** - Cache and message broker
- **Bull** - Job queue management
- **JWT** - Authentication tokens
- **bcrypt** - Password hashing

### Worker Agent
- **Node.js** - Worker runtime
- **Dockerode** - Docker API client
- **Socket.io Client** - Connect to orchestrator
- **systeminformation** - Resource monitoring

### Container Runtime
- **Docker** - Container execution
- **NVIDIA Container Runtime** - GPU support for CUDA workloads

## 📁 Project Structure

```
pbl/
├── orchestrator/          # Main server (manages jobs & workers)
│   ├── src/
│   │   ├── index.js      # Server entry point
│   │   ├── db/           # Database models & migrations
│   │   ├── routes/       # API endpoints
│   │   ├── services/     # Business logic
│   │   │   ├── WorkerManager.js
│   │   │   └── JobScheduler.js
│   │   ├── middleware/   # Auth, validation
│   │   └── utils/        # Logger, helpers
│   ├── package.json
│   └── .env
│
├── worker/               # Worker agent (runs on GPU/CPU machines)
│   ├── src/
│   │   ├── index.js      # Worker entry point
│   │   ├── services/
│   │   │   ├── DockerExecutor.js
│   │   │   └── ResourceMonitor.js
│   │   └── utils/
│   ├── config.json       # Worker configuration
│   └── package.json
│
├── frontend/             # Next.js web application
│   ├── src/
│   │   ├── pages/        # Next.js pages
│   │   ├── components/   # React components
│   │   ├── contexts/     # Auth context
│   │   ├── lib/          # API client
│   │   └── styles/       # Global styles
│   ├── package.json
│   └── .env.local
│
├── package.json          # Root workspace config
├── README.md            # This file
├── SETUP.md             # Detailed setup instructions
├── GPU_ALLOCATION_GUIDE.md  # GPU/CPU allocation details
└── architecture.html    # Interactive architecture diagrams
```

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** installed
- **PostgreSQL** installed and running
- **Redis** installed and running
- **Docker** installed (for worker machines)
- **NVIDIA Drivers + Container Toolkit** (for GPU workers)

### 1. Install Dependencies
```bash
cd c:\Users\hp\Desktop\pbl
npm install
```

### 2. Setup Database
```bash
# Create PostgreSQL database
createdb gpu_rental

# Or using psql
psql -U postgres -c "CREATE DATABASE gpu_rental;"
```

### 3. Configure Orchestrator
```bash
cd orchestrator
cp .env.example .env
# Edit .env with your database credentials and secrets
npm run db:migrate
```

### 4. Configure Worker (on each GPU/CPU machine)
```bash
cd worker
cp config.example.json config.json
# Edit config.json with orchestrator IP and worker specs
```

### 5. Configure Frontend
```bash
cd frontend
cp .env.local.example .env.local
# Edit .env.local with API URLs
```

### 6. Start Services

**Terminal 1 - Orchestrator:**
```bash
cd orchestrator
npm run dev
```

**Terminal 2 - Worker:**
```bash
cd worker
npm run dev
```

**Terminal 3 - Frontend:**
```bash
cd frontend
npm run dev
```

### 7. Access the Platform
- **Frontend**: http://localhost:3001
- **API**: http://localhost:3000
- **Create account** and start submitting jobs!

## 📖 Documentation

- **[SETUP.md](SETUP.md)** - Comprehensive setup guide with troubleshooting
- **[GPU_ALLOCATION_GUIDE.md](GPU_ALLOCATION_GUIDE.md)** - How GPU/CPU allocation works
- **[architecture.html](architecture.html)** - Interactive architecture diagrams

## 🔧 Configuration

### Orchestrator (.env)
```env
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/gpu_rental
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-secret-key
WORKER_SECRET_TOKEN=worker-token
GPU_PRICE_PER_MINUTE=0.10
CPU_PRICE_PER_MINUTE=0.02
```

### Worker (config.json)
```json
{
  "orchestratorUrl": "http://192.168.1.10:3000",
  "workerId": "worker-lab1-gpu01",
  "workerToken": "worker-token",
  "resources": {
    "type": "GPU",
    "gpuModel": "NVIDIA RTX 3090",
    "gpuCount": 2,
    "cpuCores": 16,
    "ram": 64
  }
}
```

## 🎯 Usage

### Submit a Job

1. **Login** to the web interface
2. **Upload Dockerfile** or paste content
3. **Select Resources**:
   - GPU count (0-4)
   - CPU cores (1-32)
   - RAM (1-128 GB)
4. **Submit** and monitor in real-time
5. **Download results** when complete

### Example Dockerfile (GPU Job)
```dockerfile
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y python3-pip
RUN pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu118

COPY train.py /app/
WORKDIR /app

CMD ["python3", "train.py"]
```

## 🔒 Security Features

- **JWT Authentication** - Secure token-based auth
- **bcrypt Password Hashing** - Industry-standard password security
- **Container Isolation** - Docker security features
- **Network Restrictions** - Containers run in isolated network mode
- **Resource Limits** - CPU, memory, and GPU quotas enforced
- **Worker Token Auth** - Secure worker-orchestrator communication
- **No Privileged Containers** - Security-opt flags prevent escalation

## 💰 Pricing Model

- **GPU**: $0.10 per minute per GPU
- **CPU**: $0.02 per minute per CPU core
- **New users**: Start with $100 credits
- **Pay-as-you-go**: Only charged for actual usage time

Example: 2 GPUs + 8 CPUs for 30 minutes = 2×$0.10×30 + 8×$0.02×30 = $10.80

## 🛠️ Development

### Run in Development Mode
```bash
# All services
npm run dev

# Individual services
npm run dev:orchestrator
npm run dev:worker
npm run dev:frontend
```

### Build for Production
```bash
npm run build
npm start
```

### Run Database Migrations
```bash
cd orchestrator
npm run db:migrate
```

## 📊 Monitoring

### Check Orchestrator Logs
```bash
cd orchestrator
tail -f logs/combined.log
```

### Check Worker Logs
```bash
cd worker
tail -f logs/combined.log
```

### View Active Jobs
Access the dashboard at http://localhost:3001/dashboard

## 🐛 Troubleshooting

### Orchestrator won't start
- Check PostgreSQL is running: `pg_isready`
- Check Redis is running: `redis-cli ping`
- Verify DATABASE_URL in `.env`
- Check logs: `orchestrator/logs/error.log`

### Worker won't connect
- Verify orchestrator IP is correct in `config.json`
- Check `workerToken` matches orchestrator's `WORKER_SECRET_TOKEN`
- Ensure firewall allows port 3000
- Check worker logs: `worker/logs/combined.log`

### GPU not detected
- Verify NVIDIA drivers: `nvidia-smi`
- Check Docker GPU support: `docker run --gpus all nvidia/cuda:11.0-base nvidia-smi`
- Install NVIDIA Container Toolkit if missing

### Jobs fail to execute
- Check Docker is running: `docker ps`
- Verify worker has sufficient resources
- Review job logs in the web interface
- Check worker logs for Docker errors

## 🤝 Contributing

This is a college project. Contributions, issues, and feature requests are welcome!

## 📝 API Endpoints

### Authentication
- `POST /api/auth/register` - Create new user account
- `POST /api/auth/login` - Login and get JWT token

### Jobs
- `POST /api/jobs` - Submit new job
- `GET /api/jobs` - Get user's jobs
- `GET /api/jobs/:id` - Get job details
- `POST /api/jobs/:id/cancel` - Cancel running job

### Workers
- `GET /api/workers` - Get all workers (admin)
- `GET /api/workers/stats` - Get worker statistics

### Users
- `GET /api/users/profile` - Get user profile
- `GET /api/users/billing` - Get billing history

## 🌐 Network Setup

### Same LAN (Recommended for College Labs)
```
Router (192.168.1.1)
├── Orchestrator (192.168.1.10:3000)
├── GPU Worker 1 (192.168.1.101)
├── GPU Worker 2 (192.168.1.102)
└── CPU Worker 1 (192.168.1.103)
```

Workers connect to orchestrator via local IP - fast and secure!

## 📈 Scalability

The platform supports:
- **Multiple workers** - Add as many GPU/CPU machines as needed
- **Concurrent jobs** - Limited only by available worker resources
- **Job queuing** - Automatic queuing when all workers are busy
- **Auto-scaling** - Workers can be added/removed dynamically

## 🎓 College Lab Use Case

Perfect for:
- **Machine Learning Training** - Utilize idle lab GPUs for student projects
- **Data Processing** - Run batch jobs on available CPU resources
- **Research Projects** - Share computing resources across departments
- **Cost Efficiency** - Maximize ROI on existing hardware investments

## 📜 License

This project is for educational purposes as part of a college project.

## 👥 Authors

College PBL Project Team - 2026

## 🙏 Acknowledgments

- Built with modern web technologies
- Designed for efficient resource utilization
- Focused on security and reliability
- Scalable architecture for future growth

---

**Ready to start computing?** 🚀

See [SETUP.md](SETUP.md) for detailed installation instructions!
#   P B L  
 