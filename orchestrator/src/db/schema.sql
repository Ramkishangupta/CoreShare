-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  credits DECIMAL(10, 2) DEFAULT 100.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_credits_non_negative CHECK (credits >= 0)
);

-- Workers table
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  worker_id VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'GPU' or 'CPU'
  specs JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'offline', -- 'idle', 'busy', 'offline'
  socket_id VARCHAR(255),
  last_heartbeat TIMESTAMP,
  current_job_ids JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
  dockerfile TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'queued', 'running', 'completed', 'failed', 'cancelled'
  resources_requested JSONB NOT NULL,
  priority INTEGER DEFAULT 0,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  logs TEXT,
  result JSONB,
  error_message TEXT,
  max_duration_minutes INTEGER DEFAULT 60,
  actual_duration_minutes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Billing table
CREATE TABLE IF NOT EXISTS billing (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  cost DECIMAL(10, 2) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  resources_used JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_cost_positive CHECK (cost > 0),
  CONSTRAINT check_cost_reasonable CHECK (cost < 1000000),
  CONSTRAINT check_duration_reasonable CHECK (duration_minutes > 0 AND duration_minutes <= 10080)
);

-- Worker API keys table (for secure worker authentication)
CREATE TABLE IF NOT EXISTS worker_api_keys (
  id SERIAL PRIMARY KEY,
  worker_id VARCHAR(255) UNIQUE NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- Failed authentication attempts logging
CREATE TABLE IF NOT EXISTS worker_auth_failures (
  id SERIAL PRIMARY KEY,
  worker_id VARCHAR(255),
  ip_address VARCHAR(45),
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);

-- API rate limiting tracking
CREATE TABLE IF NOT EXISTS api_rate_limits (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(key, endpoint, window_start)
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_workers_status ON workers(status);
CREATE INDEX idx_workers_worker_id ON workers(worker_id);
CREATE INDEX idx_workers_is_active ON workers(is_active);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_worker_id ON jobs(worker_id);
CREATE INDEX idx_billing_user_id ON billing(user_id);
CREATE INDEX idx_billing_job_id ON billing(job_id);
CREATE INDEX idx_billing_cost ON billing(cost);
CREATE INDEX idx_billing_created_at ON billing(created_at);
CREATE INDEX idx_worker_api_keys_worker_id ON worker_api_keys(worker_id);
CREATE INDEX idx_worker_api_keys_active ON worker_api_keys(is_active);
CREATE INDEX idx_worker_auth_failures_worker_id_time ON worker_auth_failures(worker_id, attempted_at);
CREATE INDEX idx_worker_auth_failures_ip_time ON worker_auth_failures(ip_address, attempted_at);
CREATE INDEX idx_api_rate_limits_key_endpoint ON api_rate_limits(key, endpoint, window_start);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to limit log size (1MB max)
CREATE OR REPLACE FUNCTION limit_log_size()
RETURNS TRIGGER AS $$
BEGIN
  IF LENGTH(NEW.logs) > 1000000 THEN
    NEW.logs := SUBSTRING(NEW.logs FROM 1 FOR 999950) || 
                E'\n\n... [LOGS TRUNCATED - 1MB LIMIT REACHED]';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cleanup functions
CREATE OR REPLACE FUNCTION cleanup_old_auth_failures()
RETURNS void AS $$
BEGIN
  DELETE FROM worker_auth_failures 
  WHERE attempted_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM api_rate_limits 
  WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workers_updated_at BEFORE UPDATE ON workers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to limit log size on jobs table
CREATE TRIGGER limit_job_logs
  BEFORE INSERT OR UPDATE OF logs ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION limit_log_size();
