const express = require('express');
const authenticateToken = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, credits, role, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        credits: parseFloat(user.credits),
        role: user.role,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get user billing history
router.get('/billing', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, j.status as job_status
       FROM billing b
       JOIN jobs j ON b.job_id = j.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC
       LIMIT 100`,
      [req.user.userId]
    );

    res.json({
      billing: result.rows.map(b => ({
        id: b.id,
        jobId: b.job_id,
        cost: parseFloat(b.cost),
        duration: b.duration_minutes,
        resources: b.resources_used,
        createdAt: b.created_at
      }))
    });
  } catch (error) {
    console.error('Fetch billing error:', error);
    res.status(500).json({ error: 'Failed to fetch billing' });
  }
});

module.exports = router;
