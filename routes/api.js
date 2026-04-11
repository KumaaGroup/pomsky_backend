const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

// GET all dashboard data in one call
router.get('/dashboard', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  // Get profile + membership info
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({
    user: {
      name: profile.full_name,
      email: profile.email,
      account_type: profile.account_type,
      membership_type: profile.membership_type,
      membership_status: profile.membership_status,
      created_at: profile.created_at
    }
  });
});

module.exports = router;