const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

router.post('/schedule-litter', async (req, res) => {
    
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    // Get user
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData.user;

    // Get profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_type')
      .eq('id', user.id)
      .single();

    // 🔒 Only Gold allowed
    if (profile.membership_type !== 'breeder_gold') {
      return res.status(403).json({ error: 'Only Gold members allowed' });
    }

    const { name, kennel, message, url, date } = req.body;

    // 🧠 Monthly limit check
    const startOfMonth = new Date();
    startOfMonth.setDate(1);

    const { data: existing } = await supabase
      .from('litter_requests')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', startOfMonth.toISOString());

    if (existing.length >= 1) {
      return res.status(400).json({
        error: 'You can only submit one litter per month'
      });
    }

    // ✅ Insert request
    await supabase.from('litter_requests').insert({
      user_id: user.id,
      name,
      kennel,
      message,
      url,
      date,
      status: 'pending'
    });

    res.json({ message: 'Submitted successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my-requests', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: userData } = await supabase.auth.getUser(token);

  const { data } = await supabase
    .from('litter_requests')
    .select('*')
    .eq('user_id', userData.user.id);

  res.json({ requests: data || [] });
});

module.exports = router;