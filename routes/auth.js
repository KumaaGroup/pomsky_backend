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

  const accessToken = data.session?.access_token;

  res.cookie('token', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({
    message: 'Logged in!',
    user: data.user,
    access_token: accessToken,
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
  try {
    console.log("COOKIE:", req.cookies);
    console.log("AUTH HEADER:", req.headers.authorization);

    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
      console.log("NO TOKEN");
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { data, error } = await supabase.auth.getUser(token);

    console.log("USER DATA:", data);
    console.log("ERROR:", error);

    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = data.user.id;

    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_type')
      .eq('id', userId)
      .maybeSingle();

    const { data: breeder } = await supabase
      .from('breeder_profiles')
      .select('is_onboarded')
      .eq('user_id', userId)
      .maybeSingle();

    res.json({
      user: data.user,
      membership_type: profile?.membership_type || null,
      is_onboarded: breeder?.is_onboarded || false
    });

  } catch (err) {
    console.error("ME ERROR:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// FORGOT PASSWORD
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.FRONTEND_URL}/reset-password`
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Password reset link sent to your email' });
});

// RESET PASSWORD
router.post('/reset-password', async (req, res) => {
  const { access_token, new_password } = req.body;

  if (!access_token || !new_password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const { error } = await supabase.auth.updateUser(
    { password: new_password },
    { access_token }
  );

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Password updated successfully' });
});

module.exports = router;