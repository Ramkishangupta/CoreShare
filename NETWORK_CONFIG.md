# Network Configuration Guide

This guide explains how to configure the platform for network deployment across multiple machines.

## 🎯 Deployment Scenarios

### Scenario 1: Local Development (Single Machine)
All services running on one machine for testing.

**Configuration:**
- Orchestrator: `localhost:3000`
- Frontend: `localhost:3001`
- Worker: `localhost`

### Scenario 2: College Network (Recommended)
Multiple machines on same LAN/Wi-Fi network.

**Example Network:**
```
Router (192.168.1.1)
├── Orchestrator Server (192.168.1.100)
├── GPU Worker 1 (192.168.1.101)
├── GPU Worker 2 (192.168.1.102)
└── CPU Worker 1 (192.168.1.103)
```

## 📍 Finding Your IP Address

### Windows
```bash
ipconfig
```
Look for "IPv4 Address" under your network adapter (usually 192.168.x.x)

### Linux
```bash
hostname -I
# or
ip addr show
```
Look for inet address (usually 192.168.x.x)

### macOS
```bash
ifconfig
```
Look for "inet" under your active network interface

## 🔧 Configuration Steps

### Step 1: Configure Orchestrator

**File:** `orchestrator/.env`

```env
PORT=3000
SERVER_IP=192.168.1.100  # YOUR SERVER IP
DATABASE_URL=postgresql://user:pass@localhost:5432/gpu_rental
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
WORKER_SECRET_TOKEN=worker-token-change-this-to-something-secure
CORS_ORIGIN=http://192.168.1.100:3001  # YOUR SERVER IP:3001
GPU_PRICE_PER_MINUTE=0.10
CPU_PRICE_PER_MINUTE=0.02
INITIAL_CREDITS=100
LOG_LEVEL=info
NODE_ENV=production
```

**Important:**
- Replace `192.168.1.100` with your actual server IP
- `CORS_ORIGIN` must match where frontend will be accessed

### Step 2: Configure Frontend

**File:** `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://192.168.1.100:3000/api
NEXT_PUBLIC_WS_URL=http://192.168.1.100:3000
```

**Important:**
- Use the orchestrator server's IP
- For local dev: use `localhost`
- For network access: use network IP

### Step 3: Configure Each Worker

**File:** `worker/config.json` (on each worker machine)

```json
{
  "orchestratorUrl": "http://192.168.1.100:3000",
  "workerId": "worker-lab1-gpu01",
  "workerToken": "worker-token-change-this-to-something-secure",
  ...
}
```

**Important:**
- All workers point to same orchestrator IP
- Each worker needs unique `workerId`
- `workerToken` must match orchestrator's `WORKER_SECRET_TOKEN`

## 🔥 Firewall Configuration

### Windows Firewall

**Allow port 3000 (Orchestrator):**
```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="GPU Platform Orchestrator" dir=in action=allow protocol=TCP localport=3000

# Optional: Allow port 3001 (Frontend)
netsh advfirewall firewall add rule name="GPU Platform Frontend" dir=in action=allow protocol=TCP localport=3001
```

### Linux Firewall (UFW)

```bash
sudo ufw allow 3000/tcp comment "GPU Platform Orchestrator"
sudo ufw allow 3001/tcp comment "GPU Platform Frontend"
sudo ufw reload
```

### Linux Firewall (firewalld)

```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload
```

## 🧪 Testing Network Connectivity

### From Worker Machine to Orchestrator

```bash
# Test network connectivity
ping 192.168.1.100

# Test port is open
telnet 192.168.1.100 3000
# or
curl http://192.168.1.100:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "workers": {...},
  "timestamp": "..."
}
```

### From Browser to Frontend

Navigate to: `http://192.168.1.100:3001`

You should see the landing page.

### From Browser to API

Navigate to: `http://192.168.1.100:3000/health`

You should see JSON health info.

## 🚨 Common Issues

### Workers Can't Connect

**Symptom:** Worker logs show connection refused

**Solutions:**
1. Verify orchestrator is running: `curl http://ORCHESTRATOR_IP:3000/health`
2. Check firewall allows port 3000
3. Verify worker's `orchestratorUrl` is correct
4. Ping orchestrator: `ping ORCHESTRATOR_IP`
5. Check both machines are on same network

### Frontend Can't Connect to API

**Symptom:** "Network Error" in browser console

**Solutions:**
1. Check `NEXT_PUBLIC_API_URL` in `frontend/.env.local`
2. Verify CORS_ORIGIN in `orchestrator/.env` matches frontend URL
3. Check firewall allows port 3000
4. Test API directly: `curl http://ORCHESTRATOR_IP:3000/health`

### CORS Errors

**Symptom:** Browser shows "CORS policy" errors

**Solutions:**
1. Verify `CORS_ORIGIN` in orchestrator `.env` matches frontend URL
2. Include protocol: `http://` not just IP
3. Include port number: `:3001`
4. Restart orchestrator after changing `.env`

### Workers Show Invalid Token

**Symptom:** Worker logs show "Invalid worker token"

**Solutions:**
1. Check `workerToken` in `worker/config.json`
2. Check `WORKER_SECRET_TOKEN` in `orchestrator/.env`
3. Ensure they match exactly (no extra spaces/quotes)
4. Restart both services

## 📱 Accessing from Other Devices

### Access Frontend from Phone/Tablet (Same Network)

Simply navigate to: `http://192.168.1.100:3001`

Make sure:
- Device is on same Wi-Fi/network
- Firewall allows incoming connections
- Frontend is bound to `0.0.0.0` (not just `localhost`)

### Access from Different Network

You need:
1. Port forwarding on router (ports 3000, 3001)
2. Static IP or dynamic DNS
3. **SECURITY RISK** - Only for trusted networks!

## 🔒 Security Recommendations

### Production Deployment

1. **Change all default secrets:**
   - `JWT_SECRET` (minimum 32 characters)
   - `WORKER_SECRET_TOKEN`
   - Database passwords

2. **Use HTTPS** (for production):
   - Set up reverse proxy (nginx/Apache)
   - Get SSL certificate (Let's Encrypt)
   - Update frontend URLs to use `https://`

3. **Firewall rules:**
   - Only allow required ports
   - Restrict access to trusted IPs if possible
   - Close ports when not needed

4. **Network security:**
   - Keep all software updated
   - Use strong passwords
   - Monitor logs for suspicious activity

## 📊 Network Architecture

```
                                    Internet (Optional)
                                           |
                                    [Router/Firewall]
                                           |
                            ┌──────────────┼──────────────┐
                            │              │              │
                    ┌───────▼──────┐  ┌────▼─────┐  ┌────▼─────┐
                    │ Orchestrator │  │  Worker  │  │  Worker  │
                    │   Server     │  │    1     │  │    2     │
                    │   (100)      │  │  (101)   │  │  (102)   │
                    └──────┬───────┘  └──────────┘  └──────────┘
                           │
                    ┌──────┴───────┐
                    │  PostgreSQL  │
                    │    Redis     │
                    └──────────────┘
                           
        Users access via: http://192.168.1.100:3001
```

## ✅ Configuration Checklist

Before deploying:

- [ ] Found orchestrator server's IP address
- [ ] Updated `orchestrator/.env` with server IP
- [ ] Set `CORS_ORIGIN` to match frontend URL
- [ ] Updated `frontend/.env.local` with API URLs
- [ ] Updated ALL worker `config.json` files with orchestrator IP
- [ ] Ensured all worker tokens match orchestrator
- [ ] Opened firewall port 3000 on orchestrator server
- [ ] Tested orchestrator health endpoint
- [ ] Tested frontend loads from another machine
- [ ] Verified worker connects successfully
- [ ] Submitted test job and verified completion

## 📞 Need Help?

Check the troubleshooting sections in:
- [SETUP.md](./SETUP.md) - General setup issues
- [README.md](./README.md) - Project overview
- Worker logs: `worker/logs/combined.log`
- Orchestrator logs: `orchestrator/logs/combined.log`
