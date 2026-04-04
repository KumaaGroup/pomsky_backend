const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// REGISTER
// routes/auth.js
router.post('/register', async (req, res) => {
  const { email, password, name, account_type, membership_type } = req.body;

  // Default free memberships per account type
  const freeTiers = {
    shopper: 'shopper_free',
    owner: 'owner_free',
    breeder: 'breeder_free'
  };

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });

  if (error) return res.status(400).json({ error: error.message });
  if (!data.user || !data.user.id) {
    return res.status(400).json({ error: 'User creation failed' });
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: data.user.id,
      full_name: name,
      email: email,
      account_type: account_type || 'shopper',
      membership_type: membership_type || freeTiers[account_type] || 'shopper_free'
    });

  if (profileError) return res.status(400).json({ error: profileError.message });

  res.json({ message: 'Registered successfully!', user: data.user });
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(401).json({ error: error.message });

  // Store token in httpOnly cookie (secure)
  res.cookie('token', data.session.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({ message: 'Logged in!', user: data.user });
});

// LOGOUT
router.post('/logout', async (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out!' });
});

// GET CURRENT USER
router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return res.status(401).json({ error: 'Invalid token' });

  res.json({ user: data.user });
});

module.exports = router;