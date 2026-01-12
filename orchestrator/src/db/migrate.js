require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');
const logger = require('../utils/logger');

async function migrate() {
  try {
    logger.info('Starting database migration...');
    
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );

    await pool.query(schemaSQL);
    
    logger.info('✅ Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
