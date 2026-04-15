const multer = require('multer');
const upload = multer();
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// const multer = require('multer');
// const upload = multer();

router.post('/schedule-litter', upload.array('photos'), async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData || !userData.user) {
  return res.status(401).json({ error: 'Invalid user' });
}

const user = userData.user;

    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_type')
      .eq('id', user.id)
      .single();

    if (!profile) {
  return res.status(400).json({ error: 'Profile not found' });
}

if (profile.membership_type !== 'breeder_gold') {
  return res.status(403).json({ error: 'Only Gold members allowed' });
}

    const { name, kennel, message, url, date } = req.body;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);

    const { data: existing } = await supabase
      .from('litter_requests')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', startOfMonth.toISOString());

    if ((existing || []).length >= 1) {
      return res.status(400).json({
        error: 'You can only submit one litter per month'
      });
    }

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
    console.error("🔥 FULL ERROR:", err);
console.error("🔥 STACK:", err.stack);
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