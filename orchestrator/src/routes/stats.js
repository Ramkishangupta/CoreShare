const express = require('express');
const router = express.Router();
const db = require('../db');
const authenticateToken = require('../middleware/auth');

// Get user statistics
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    try {
        // Get total jobs count
        const totalJobsResult = await db.query(
            'SELECT COUNT(*) as count FROM jobs WHERE user_id = $1',
            [userId]
        );
        const totalJobs = parseInt(totalJobsResult.rows[0].count);

        // Get jobs by status
        const statusResult = await db.query(
            `SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'queued') as queued
       FROM jobs 
       WHERE user_id = $1`,
            [userId]
        );

        const completedJobs = parseInt(statusResult.rows[0].completed);
        const failedJobs = parseInt(statusResult.rows[0].failed);
        const runningJobs = parseInt(statusResult.rows[0].running);
        const queuedJobs = parseInt(statusResult.rows[0].queued);

        // Calculate success rate
        const successRate = totalJobs > 0 ? ((completedJobs / totalJobs) * 100).toFixed(1) : 0;

        // Calculate total spent (simulate with job duration * rate)
        const costResult = await db.query(
            `SELECT 
        SUM(
          EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time)) / 60 * 
          ((resources_requested->>'cpu')::int * 0.02 + 
           COALESCE((resources_requested->>'gpu')::int, 0) * 0.1)
        ) as total_cost
       FROM jobs 
       WHERE user_id = $1 AND start_time IS NOT NULL`,
            [userId]
        );
        const totalSpent = parseFloat(costResult.rows[0].total_cost || 0);

        // Calculate this month's spending
        const monthCostResult = await db.query(
            `SELECT 
        SUM(
          EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time)) / 60 * 
          ((resources_requested->>'cpu')::int * 0.02 + 
           COALESCE((resources_requested->>'gpu')::int, 0) * 0.1)
        ) as month_cost
       FROM jobs 
       WHERE user_id = $1 
         AND start_time IS NOT NULL
         AND created_at >= date_trunc('month', CURRENT_DATE)`,
            [userId]
        );
        const thisMonthSpent = parseFloat(monthCostResult.rows[0].month_cost || 0);

        res.json({
            totalJobs,
            completedJobs,
            failedJobs,
            runningJobs,
            queuedJobs,
            successRate: parseFloat(successRate),
            totalSpent: totalSpent.toFixed(2),
            thisMonthSpent: thisMonthSpent.toFixed(2)
        });

    } catch (error) {
        console.error('Stats fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

module.exports = router;
