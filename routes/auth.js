const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// REGISTER
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Check your email to confirm!', user: data.user });
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