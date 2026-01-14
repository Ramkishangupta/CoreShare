require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');
const logger = require('../utils/logger');

/**
 * Simple database setup script
 * Runs the complete schema.sql file to set up all tables, functions, and triggers
 * 
 * Use this for:
 * - Fresh database setup
 * - Resetting the database (will drop existing tables if they exist)
 * 
 * Note: The schema.sql file uses IF NOT EXISTS clauses, so it's safe to run multiple times
 */

async function migrate() {
  try {
    logger.info('Starting database setup...');

    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );

    await pool.query(schemaSQL);

    logger.info('✅ Database setup completed successfully');
    logger.info('All tables, constraints, functions, and triggers created');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Database setup failed:', error);
    logger.error('Error details:', error.message);
    process.exit(1);
  }
}

migrate();
