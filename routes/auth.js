const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// REGISTER
router.post('/register', async (req, res) => {
  const { email, password, name, account_type } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { 
      data: { 
        name,
        account_type: account_type || 'shopper',
        membership_type: account_type === 'breeder' ? 'breeder_free' : 
                         account_type === 'owner' ? 'owner_free' : 'shopper_free'
      } 
    }
  });

  if (error) return res.status(400).json({ error: error.message });
  if (!data.user) return res.status(500).json({ error: 'User creation failed' });

  res.json({ message: 'Registered successfully!', user: data.user });
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) return res.status(401).json({ error: error.message });

  res.cookie('token', data.session.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({
    message: 'Logged in!',
    user: data.user,
    redirect: '/dashboard'
  });
});

// LOGOUT
router.post('/logout', async (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'None'
  });
  res.json({ message: 'Logged out!' });
});

// GET CURRENT USER + PROFILE
router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  res.json({ user: data.user, profile });
});

module.exports = router;