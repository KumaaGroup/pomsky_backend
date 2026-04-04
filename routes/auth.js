const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// REGISTER
router.post('/register', async (req, res) => {
  const { email, password, name, account_type } = req.body;

  const defaultMembership = {
    breeder: 'breeder_free',
    owner: 'shopper',
    shopper: 'shopper'
  };

  // Step 1: Create user in Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });

  if (error) return res.status(400).json({ error: error.message });

  // Step 2: Make sure user ID exists before inserting profile
  if (!data.user || !data.user.id) {
    return res.status(400).json({ error: 'User creation failed, no ID returned' });
  }

  // Step 3: Insert profile using the confirmed user ID
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: data.user.id,       // this must match auth.users id
      full_name: name,
      email: email,
      account_type: account_type || 'shopper',
      membership_type: defaultMembership[account_type] || 'shopper'
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