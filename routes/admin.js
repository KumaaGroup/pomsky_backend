const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');
const nodemailer = require('nodemailer');

// ── Email transporter (Gmail SMTP) ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS   // App Password, NOT your real Gmail password
  }
});
async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: `"Pomsky Association" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html
    });
    console.log(`Email sent to ${to}`);
  } catch (err) {
    console.error('EMAIL ERROR:', err.message);
  }
}

// Admin auth middleware
const adminAuth = async (req, res, next) => {
  const token = req.cookies.admin_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ── Admin Auth ──

router.post('/setup', async (req, res) => {
  const { email, password, name, setup_key } = req.body;

  if (setup_key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: 'Invalid setup key' });
  }

  const hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from('admins')
    .insert({ email, password_hash: hash, name })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Admin created!', admin: { id: data.id, email: data.email } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data: admin, error } = await supabase
    .from('admins')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !admin) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

 res.cookie('admin_token', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'None',
  path: '/'
});

  res.json({ message: 'Logged in!', admin: { name: admin.name, email: admin.email } });
});

router.post('/logout', (req, res) => {
  res.clearCookie('admin_token', { httpOnly: true, secure: true, sameSite: 'None' });
  res.json({ message: 'Logged out!' });
});

// ── Users Management ──

router.get('/users', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ users: data });
});

router.patch('/users/:id/membership', adminAuth, async (req, res) => {
  const { membership_type, membership_status } = req.body;

  const { error } = await supabase
    .from('profiles')
    .update({ membership_type, membership_status })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'User updated!' });
});

router.delete('/users/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'User deleted!' });
});

// ── Store Items ──

router.get('/store-items', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('store_items')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ items: data });
});

router.post('/store-items', adminAuth, async (req, res) => {
  const { name, description, price, image_url, category, stock_quantity } = req.body;

  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });

  const { data, error } = await supabase
    .from('store_items')
    .insert({ name, description, price, image_url, category, stock_quantity: stock_quantity || 0 })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Item added!', item: data });
});

router.patch('/store-items/:id', adminAuth, async (req, res) => {
  const { name, description, price, image_url, category, stock_quantity, is_active } = req.body;

  const { error } = await supabase
    .from('store_items')
    .update({ name, description, price, image_url, category, stock_quantity, is_active })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Item updated!' });
});

router.delete('/store-items/:id', adminAuth, async (req, res) => {
  const { error } = await supabase
    .from('store_items')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Item deleted!' });
});

// ── Dashboard Stats ──

router.get('/stats', adminAuth, async (req, res) => {
  const [usersResult, storeResult, ordersResult, listingsResult] = await Promise.all([
    supabase.from('profiles').select('membership_type'),
    supabase.from('store_items').select('id, is_active'),
    supabase.from('orders').select('total, status'),
    supabase.from('pomsky_listings').select('id, is_active')
  ]);

  const users = usersResult.data || [];
  const membershipCounts = users.reduce((acc, u) => {
    acc[u.membership_type] = (acc[u.membership_type] || 0) + 1;
    return acc;
  }, {});

  res.json({
    total_users: users.length,
    total_store_items: (storeResult.data || []).length,
    active_store_items: (storeResult.data || []).filter(i => i.is_active).length,
    total_orders: (ordersResult.data || []).length,
    total_listings: (listingsResult.data || []).length,
    active_listings: (listingsResult.data || []).filter(l => l.is_active).length,
    membership_counts: membershipCounts
  });
});

// ── Pomsky Listings Management ──

// Get all listings
router.get('/listings', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('pomsky_listings')
    .select(`
      *,
      breeder_profiles (breeder_name, business_name)
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ listings: data });
});

// Approve or feature a listing
router.patch('/listings/:id', adminAuth, async (req, res) => {
  const { is_active, is_featured } = req.body;

  const { error } = await supabase
    .from('pomsky_listings')
    .update({ is_active, is_featured })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Listing updated!' });
});

// Delete a listing
router.delete('/listings/:id', adminAuth, async (req, res) => {
  const { error } = await supabase
    .from('pomsky_listings')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Listing deleted!' });
});

// ── Breeders Management ──

// Get all breeder profiles
router.get('/breeders', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('breeder_profiles')
    .select(`
      *,
      profiles (full_name, email, membership_type)
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ breeders: data });
});

// Approve or feature a breeder
router.patch('/breeders/:id', adminAuth, async (req, res) => {
  const { is_approved, is_featured } = req.body;

  const { error } = await supabase
    .from('breeder_profiles')
    .update({ is_approved, is_featured })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Breeder updated!' });
});

// Delete a breeder profile
router.delete('/breeders/:id', adminAuth, async (req, res) => {
  const { error } = await supabase
    .from('breeder_profiles')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Breeder deleted!' });
});

// ── Litter Requests Management ──

// Get all litter requests
router.get('/litter-requests', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('litter_requests')
    .select(`
      id, status, created_at,
      name, kennel, message, url, date,
      availability, puppies_available, state,
      price_min, price_max, next_litter,
      pomsky_type, gender, markings,
      contact_email, contact_phone, images,
      user_id
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ requests: data });
});

// Approve request
router.patch('/litter-requests/:id/approve', adminAuth, async (req, res) => {
  try {
    // 1. Fetch request
    const { data: request, error: fetchError } = await supabase
      .from('litter_requests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !request) {
      console.error("FETCH ERROR:", fetchError);
      return res.status(404).json({ error: 'Request not found' });
    }

    // 2. Get or auto-create breeder profile
    let breeder = null;

    const { data: existingBreeder } = await supabase
      .from('breeder_profiles')
      .select('id')
      .eq('user_id', request.user_id)
      .maybeSingle();

    if (existingBreeder) {
      breeder = existingBreeder;
    } else {
      const { data: newBreeder, error: createError } = await supabase
        .from('breeder_profiles')
        .insert({
          user_id: request.user_id,
          breeder_name: request.name || 'New Breeder',
          business_name: request.kennel || 'Pending Setup',
          state: request.state || null,
          is_approved: true,
          is_featured: false
        })
        .select('id')
        .single();

      if (createError) {
        console.error("CREATE BREEDER ERROR:", createError);
        return res.status(400).json({ error: 'Could not create breeder profile: ' + createError.message });
      }

      breeder = newBreeder;
    }

    console.log("BREEDER:", breeder);

    // 3. Update request status to approved
    const { error: updateError } = await supabase
      .from('litter_requests')
      .update({ status: 'approved' })
      .eq('id', req.params.id);

    if (updateError) {
      console.error("UPDATE ERROR:", updateError);
      return res.status(400).json({ error: updateError.message });
    }

    // 4. Insert listing
    const { data: insertData, error: insertError } = await supabase
      .from('pomsky_listings')
      .insert({
        name: request.kennel || 'Pomsky',
        gender: request.gender || null,
        pomsky_type: request.pomsky_type || null,
        markings: request.markings || null,
        price: request.price_min || null,
        availability: request.availability || 'available',
        state: request.state || null,
        breeder_id: breeder.id,
        is_active: true,
        is_new_litter: true,
        contact_email: request.contact_email || null,
        contact_phone: request.contact_phone || null,
        images: request.images || []
      });

    if (insertError) {
      console.error("INSERT ERROR:", insertError);
      return res.status(400).json({ error: insertError.message });
    }

    // Send approval email
    const contactEmail = request.contact_email;
    if (contactEmail) {
      await sendEmail({
        to: contactEmail,
        subject: '🎉 Your Litter Listing Has Been Approved!',
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
            <div style="background:#2094B1;padding:24px;border-radius:8px;text-align:center;margin-bottom:24px;">
              <h1 style="color:white;margin:0;font-size:24px;">Litter Listing Approved! 🐾</h1>
            </div>
            <h2 style="color:#1e293b;">Great news, ${request.name}!</h2>
            <p style="color:#475569;line-height:1.6;">Your litter listing for <strong>${request.kennel}</strong> has been approved and is now live on our platform.</p>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
              <table style="width:100%;font-size:14px;color:#334155;border-collapse:collapse;">
                <tr><td style="padding:6px 0;color:#64748b;">Kennel</td><td style="font-weight:600;">${request.kennel || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;">Availability</td><td style="font-weight:600;">${request.availability || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;">State</td><td style="font-weight:600;">${request.state || '—'}</td></tr>
              </table>
            </div>
            <a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#2094B1;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">View Dashboard</a>
            <p style="color:#94a3b8;font-size:12px;margin-top:32px;">Pomsky Owners Association</p>
          </div>
        `
      });
    }

    res.json({ message: 'Approved + listing created' });

  } catch (err) {
    console.error("FULL ERROR:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reject request
router.patch('/litter-requests/:id/reject', adminAuth, async (req, res) => {
  try {
    const { data: request } = await supabase
      .from('litter_requests')
      .select('name, kennel, contact_email')
      .eq('id', req.params.id)
      .single();

    const { error } = await supabase
      .from('litter_requests')
      .update({ status: 'rejected' })
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });

    // Send rejection email
    if (request?.contact_email) {
      await sendEmail({
        to: request.contact_email,
        subject: 'Update on Your Litter Listing – Pomsky Association',
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
            <div style="background:#64748b;padding:24px;border-radius:8px;text-align:center;margin-bottom:24px;">
              <h1 style="color:white;margin:0;font-size:22px;">Listing Update</h1>
            </div>
            <h2 style="color:#1e293b;">Hi ${request.name},</h2>
            <p style="color:#475569;line-height:1.6;">Thank you for submitting your litter listing for <strong>${request.kennel}</strong>.</p>
            <p style="color:#475569;line-height:1.6;">After reviewing your submission, we are unable to approve it at this time. This may be due to incomplete information or not meeting our listing requirements.</p>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
              <p style="margin:0;color:#64748b;font-size:14px;">You're welcome to resubmit with updated information. For questions, contact us at <a href="mailto:support@pomskyassociation.com" style="color:#2094B1;">support@pomskyassociation.com</a>.</p>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin-top:32px;">Pomsky Owners Association</p>
          </div>
        `
      });
    }

    res.json({ message: 'Litter rejected!' });
  } catch (err) {
    console.error('LITTER REJECT ERROR:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/breeder-requests', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('breeder_requests')
    .select(`
      id, status, created_at,
      breeder_name, business_name, email, phone,
      state, city, country, website, bio,
      profile_image,
      social_facebook, social_instagram, social_twitter,
      user_id
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ requests: data });
});

router.patch('/breeder-requests/:id/approve', adminAuth, async (req, res) => {
  try {
    const { data: request, error: fetchError } = await supabase
      .from('breeder_requests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !request) {
      console.error('BREEDER REQUEST FETCH ERROR:', fetchError);
      return res.status(404).json({ error: 'Breeder request not found' });
    }

    const { data: existingBreeder, error: breederFetchError } = await supabase
      .from('breeder_profiles')
      .select('id, is_featured')   // also fetch is_featured to preserve manual overrides
      .eq('user_id', request.user_id)
      .maybeSingle();

    if (breederFetchError) {
      console.error('BREEDER PROFILE FETCH ERROR:', breederFetchError);
      return res.status(500).json({ error: breederFetchError.message });
    }

    // Fetch user's membership so gold breeders are auto-featured on approval
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('membership_type')
      .eq('id', request.user_id)
      .maybeSingle();

    const isGold = userProfile?.membership_type === 'breeder_gold';
    // Preserve existing is_featured if already manually set, otherwise base on membership
    const isFeatured = existingBreeder?.is_featured || isGold;

    const breederPayload = {
      user_id: request.user_id,
      breeder_name: request.breeder_name,
      business_name: request.business_name,
      state: request.state,
      city: request.city,
      country: request.country || 'US',
      phone: request.phone,
      email: request.email,
      website: request.website,
      bio: request.bio,
      profile_image: request.profile_image || null,
      social_facebook: request.social_facebook || null,
      social_instagram: request.social_instagram || null,
      social_twitter: request.social_twitter || null,
      is_approved: true,
      is_onboarded: true,
      is_featured: isFeatured  // ✅ gold = auto-featured, silver/free = false
    };

    if (existingBreeder) {
      const { error: updateError } = await supabase
        .from('breeder_profiles')
        .update(breederPayload)
        .eq('user_id', request.user_id);
      if (updateError) return res.status(500).json({ error: updateError.message });
    } else {
      const { error: insertError } = await supabase
        .from('breeder_profiles')
        .insert(breederPayload);
      if (insertError) return res.status(500).json({ error: insertError.message });
    }

    await supabase
      .from('profiles')
      .update({ account_type: 'breeder', needs_onboarding: false })
      .eq('id', request.user_id);

    await supabase
      .from('breeder_requests')
      .update({ status: 'approved' })
      .eq('id', req.params.id);

    // Send approval email
    if (request.email) {
      await sendEmail({
        to: request.email,
        subject: '🎉 Your Breeder Application Has Been Approved!',
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
            <div style="background:#2094B1;padding:24px;border-radius:8px;text-align:center;margin-bottom:24px;">
              <h1 style="color:white;margin:0;font-size:24px;">Congratulations, ${request.breeder_name}! 🐾</h1>
            </div>
            <h2 style="color:#1e293b;">Your Breeder Application is Approved</h2>
            <p style="color:#475569;line-height:1.6;">We're thrilled to welcome <strong>${request.business_name || request.breeder_name}</strong> to the Pomsky Owners Association breeder network!</p>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
              <p style="margin:0 0 8px;color:#64748b;font-size:14px;">What happens next:</p>
              <ul style="color:#334155;line-height:1.8;margin:0;padding-left:20px;">
                <li>Your breeder profile is now live on our platform</li>
                <li>You can now submit litter listings for review</li>
                <li>Log in to your dashboard to complete your profile</li>
              </ul>
            </div>
            <a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#2094B1;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;margin-top:8px;">Go to Dashboard</a>
            <p style="color:#94a3b8;font-size:12px;margin-top:32px;">Pomsky Owners Association &mdash; ${process.env.FRONTEND_URL}</p>
          </div>
        `
      });
    }

    res.json({ message: 'Breeder onboarding approved' });
  } catch (err) {
    console.error('BREEDER APPROVE ERROR:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/breeder-requests/:id/reject', adminAuth, async (req, res) => {
  try {
    const { data: request } = await supabase
      .from('breeder_requests')
      .select('breeder_name, business_name, email')
      .eq('id', req.params.id)
      .single();

    const { error } = await supabase
      .from('breeder_requests')
      .update({ status: 'rejected' })
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });

    // Send rejection email
    if (request?.email) {
      await sendEmail({
        to: request.email,
        subject: 'Update on Your Breeder Application – Pomsky Association',
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
            <div style="background:#64748b;padding:24px;border-radius:8px;text-align:center;margin-bottom:24px;">
              <h1 style="color:white;margin:0;font-size:22px;">Application Update</h1>
            </div>
            <h2 style="color:#1e293b;">Hi ${request.breeder_name},</h2>
            <p style="color:#475569;line-height:1.6;">Thank you for applying to join the Pomsky Owners Association as a breeder.</p>
            <p style="color:#475569;line-height:1.6;">After reviewing your application for <strong>${request.business_name || request.breeder_name}</strong>, we are unable to approve it at this time.</p>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
              <p style="margin:0;color:#64748b;font-size:14px;">If you believe this is an error or would like more information, please contact us at <a href="mailto:support@pomskyassociation.com" style="color:#2094B1;">support@pomskyassociation.com</a>.</p>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin-top:32px;">Pomsky Owners Association &mdash; ${process.env.FRONTEND_URL}</p>
          </div>
        `
      });
    }

    res.json({ message: 'Breeder onboarding rejected' });
  } catch (err) {
    console.error('BREEDER REJECT ERROR:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.adminAuth = adminAuth;