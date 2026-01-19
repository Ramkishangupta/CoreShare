require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function testConnection() {
    try {
        console.log('Testing database connection...');
        console.log('DATABASE_URL:', process.env.DATABASE_URL);

        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful!');
        console.log('Current time:', result.rows[0].now);

        // Now run the migration
        console.log('\nRunning database schema...');
        const schemaSQL = fs.readFileSync(
            path.join(__dirname, 'schema.sql'),
            'utf-8'
        );

        await pool.query(schemaSQL);
        console.log('✅ Database schema created successfully!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

testConnection();
