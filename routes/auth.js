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

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    user_metadata: { name }
  });

  if (error) return res.status(400).json({ error: error.message });

  const userId = data?.user?.id || data?.id;
  if (!userId) {
    console.error('Register: user created but no userId returned', data);
    return res.status(500).json({ error: 'User creation failed' });
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      full_name: name,
      email,
      account_type: account_type || 'shopper',
      membership_type: membership_type || freeTiers[account_type] || 'shopper_free'
    });

  if (profileError) {
    console.error('Profile insert failed for userId:', userId, 'error:', profileError.message);
    return res.status(400).json({ error: profileError.message });
  }

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

  // Set cookie
  res.cookie('token', data.session.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  // Send user data back so frontend doesn't need to fetch again
  res.json({ 
    message: 'Logged in!', 
    user: data.user,
    redirect: '/dashboard' // tell frontend where to go
  });
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