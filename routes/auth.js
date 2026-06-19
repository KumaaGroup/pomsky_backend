const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { triggerMembershipTag } = require('../utils/activecampaign');

// REGISTER
router.post('/register', async (req, res) => {
  const { email, password, name, account_type, redirect_to } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { 
      emailRedirectTo: redirect_to ? `${process.env.FRONTEND_URL}${redirect_to}` : `${process.env.FRONTEND_URL}/login`,
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

  // Fix database defaults: force unused memberships and statuses to null immediately after creation
  try {
    const updateData = {};
    const effective_account_type = account_type || 'shopper';

    if (effective_account_type !== 'shopper') {
      updateData.membership_shopper = null;
      updateData.status_shopper = null;
    }
    if (effective_account_type !== 'breeder') {
      updateData.membership_breeder = null;
      updateData.status_breeder = null;
    }
    if (effective_account_type !== 'owner') {
      updateData.membership_owner = null;
      updateData.status_owner = null;
    }
    
    if (Object.keys(updateData).length > 0) {
      await supabase.from('profiles').update(updateData).eq('id', data.user.id);
    }
  } catch (updateErr) {
    console.error('Error nullifying memberships:', updateErr);
  }

  const membershipType = account_type === 'breeder' ? 'breeder_free' : 
                         account_type === 'owner' ? 'owner_free' : 'shopper_free';

  // Trigger ActiveCampaign tagging for registration
  try {
    await triggerMembershipTag(email, name, membershipType);
  } catch (acErr) {
    console.error('ActiveCampaign registration tagging error:', acErr.message);
  }

  res.json({ message: 'Registered successfully!', user: data.user });
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password, redirect_to } = req.body;

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

    const userId = data.user.id;

    // Fetch profiles to determine role and membership
    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_type, membership_breeder')
      .eq('id', userId)
      .maybeSingle();

    const membership = profile?.membership_breeder || profile?.membership_type || 'shopper_free';
    const isBreeder = membership.startsWith('breeder_');

    let redirectPath = redirect_to || '/dashboard';

    if (isBreeder) {
      const { data: breeder } = await supabase
        .from('breeder_profiles')
        .select('is_onboarded, is_approved')
        .eq('user_id', userId)
        .maybeSingle();

      if (!breeder || !breeder.is_onboarded) {
        redirectPath = '/breeders-onboarding-form';
      } else if (!breeder.is_approved && membership === 'breeder_free') {
        redirectPath = '/breeder/pending-approval';
      }
    }

    res.json({
      message: 'Logged in!',
      user: data.user,
      access_token: accessToken,
      redirect: redirectPath
    });
  } catch (err) {
    console.error("Login route error:", err);
    res.status(500).json({ error: "Internal server error during login" });
  }
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
      .select('membership_type, membership_shopper, membership_breeder, membership_owner, status_shopper, status_breeder, status_owner, account_type')
      .eq('id', userId)
      .maybeSingle();

    const { data: breeder } = await supabase
      .from('breeder_profiles')
      .select('is_onboarded, is_approved')
      .eq('user_id', userId)
      .maybeSingle();

    res.json({
      user: data.user,
      // Legacy
      membership_type: profile?.membership_type || null,
      is_onboarded: breeder?.is_onboarded || false,
      is_approved: breeder?.is_approved || false,
      account_type: profile?.account_type || 'shopper',
      // Multi-role memberships
      membership_shopper: profile?.membership_shopper || 'shopper_free',
      membership_breeder: profile?.membership_breeder || 'breeder_free',
      membership_owner:   profile?.membership_owner   || 'owner_free',
      // Statuses (active / paused / cancelling)
      status_shopper: profile?.status_shopper || 'active',
      status_breeder: profile?.status_breeder || 'active',
      status_owner:   profile?.status_owner   || 'active',
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

  try {
    // 1. Verify the token and get the user
    const { data: { user }, error: userError } = await supabase.auth.getUser(access_token);
    
    if (userError || !user) {
      console.error('RESET TOKEN ERROR:', userError);
      return res.status(401).json({ error: 'Invalid or expired reset token' });
    }

    // 2. Update the user using the admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: new_password }
    );

    if (updateError) {
      console.error('RESET UPDATE ERROR:', updateError);
      return res.status(400).json({ error: updateError.message });
    }

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('RESET PASSWORD CRASH:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;