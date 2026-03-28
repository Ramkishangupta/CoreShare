const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');

async function detectHardware() {
  console.log('🔍 Detecting system hardware...');
  
  const totalMemGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024));
  const cpuCores = os.cpus().length;
  
  console.log(`   - CPU Cores: ${cpuCores}`);
  console.log(`   - Total RAM: ${totalMemGB}GB`);

  let gpuModel = null;
  let gpuCount = 0;
  let type = 'CPU';

  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader');
    const gpus = stdout.trim().split('\n').filter(line => line);
    if (gpus.length > 0) {
      gpuCount = gpus.length;
      gpuModel = gpus[0].trim();
      type = 'GPU';
      console.log(`   - GPUs Detected: ${gpuCount}x ${gpuModel}`);
    }
  } catch (error) {
    console.log('   - No NVIDIA GPUs detected or nvidia-smi not installed.');
  }

  return { type, cpuCores, totalMemGB, gpuCount, gpuModel };
}

async function generateConfig() {
  const hw = await detectHardware();

  // Reserve a percentage of system resources for the host OS.
  // Default is 35%, and input is clamped to the requested 30-40% range.
  const envReserve = Number(process.env.HOST_RESERVE_PERCENT);
  const reservePercentRaw = Number.isFinite(envReserve) ? envReserve : 35;
  const reservePercent = Math.min(40, Math.max(30, reservePercentRaw));

  const reservedRam = Math.max(1, Math.floor((hw.totalMemGB * reservePercent) / 100));
  const reservedCpus = Math.max(1, Math.floor((hw.cpuCores * reservePercent) / 100));

  const availableRam = Math.max(1, hw.totalMemGB - reservedRam);
  const availableCpus = Math.max(1, hw.cpuCores - reservedCpus);

  console.log(`   - Host reserve: ${reservePercent}% (${reservedCpus} CPU, ${reservedRam}GB RAM)`);
  console.log(`   - Worker allocatable: ${availableCpus} CPU, ${availableRam}GB RAM`);

  // If calculating safe concurrent jobs, try to give each CPU job 4 cores by default
  const estimatedConcurrentCPU = Math.max(1, Math.floor(availableCpus / 4));
  const maxJobs = hw.gpuCount > 0 ? hw.gpuCount : estimatedConcurrentCPU;

  const config = {
    orchestratorUrl: process.env.ORCHESTRATOR_URL || "http://localhost:3000",
    workerId: `worker-${os.hostname().toLowerCase()}`,
    workerToken: "worker-token-change-this-to-something-secure",
    resources: {
      type: hw.type,
      gpuModel: hw.gpuModel,
      gpuCount: hw.gpuCount,
      cpuCores: availableCpus,
      ram: availableRam,
      storage: 100
    },
    pricing: {
      gpuPerMinute: hw.gpuCount > 0 ? 0.10 : 0,
      cpuPerMinute: 0.02
    },
    docker: {
      socketPath: process.platform === 'win32' ? "//./pipe/docker_engine" : "/var/run/docker.sock",
      maxConcurrentJobs: maxJobs,
      defaultTimeout: 3600000,
      networkMode: "none",
      memoryLimit: `${Math.max(1, Math.floor(availableRam / maxJobs))}g`,
      cpuLimit: Math.max(1, Math.floor(availableCpus / maxJobs))
    },
    heartbeatInterval: 30000,
    logLevel: "info"
  };

  const outputPath = path.join(__dirname, 'config.json');
  
  if (fs.existsSync(outputPath)) {
    console.log('\n⚠️ config.json already exists! Saving as config.auto.json instead.');
    fs.writeFileSync(path.join(__dirname, 'config.auto.json'), JSON.stringify(config, null, 2));
    console.log('✅ Generated config.auto.json successfully!');
  } else {
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log('\n✅ Generated config.json successfully!');
  }
  
  console.log('\n📝 Make sure to edit the "workerToken" and "orchestratorUrl" before running!');
  console.log('💡 Optional: set HOST_RESERVE_PERCENT=30..40 (default: 35) before running generator.');
}

generateConfig().catch(console.error);
