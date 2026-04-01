const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const supabase = require('../supabase');

// Protected route example
router.get('/dashboard', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ profile: data });
});

module.exports = router;