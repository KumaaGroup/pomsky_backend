const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');

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
    .select('*')
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

    console.log("REQUEST DATA:", request);

    if (fetchError || !request) {
      console.error("FETCH ERROR:", fetchError);
      return res.status(404).json({ error: 'Request not found' });
    }

    // 🔥 2. GET BREEDER PROFILE (THIS WAS MISSING)
    // In the approve route, replace the breeder check with:
let breeder = null;
const { data: existingBreeder } = await supabase
  .from('breeder_profiles')
  .select('id')
  .eq('user_id', request.user_id)
  .maybeSingle();

if (existingBreeder) {
  breeder = existingBreeder;
} else {
  // Auto-create a breeder profile so approval doesn't fail
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
    return res.status(400).json({ error: 'Could not create breeder profile: ' + createError.message });
  }
  breeder = newBreeder;
}

    if (breederError) {
      console.error("BREEDER FETCH ERROR:", breederError);
      return res.status(400).json({ error: breederError.message });
    }

    if (!breeder) {
      return res.status(400).json({ error: 'Breeder profile not found' });
    }

    console.log("BREEDER FOUND:", breeder);

    // 3. Update request status
    const { error: updateError } = await supabase
      .from('litter_requests')
      .update({ status: 'approved' })
      .eq('id', req.params.id);

    if (updateError) {
      console.error("UPDATE ERROR:", updateError);
      return res.status(400).json({ error: updateError.message });
    }

    // 🔥 4. INSERT LISTING (NOW WORKS)
    const { data: insertData, error: insertError } = await supabase
      .from('pomsky_listings')
      .insert({
        name: request.kennel || "Pomsky",
        gender: request.gender || null,
        pomsky_type: request.pomsky_type || null,
        markings: request.markings || null,
        price: request.price_min || null,
        availability: request.availability || "available",
        state: request.state || null,

        breeder_id: breeder.id, // ✅ FIXED

        is_active: true,
        is_new_litter: true,

        contact_email: request.contact_email || null,
        contact_phone: request.contact_phone || null,

        images: request.images || []
      });

    console.log("INSERT RESULT:", insertData);
    console.error("INSERT ERROR:", insertError);

    if (insertError) {
      console.error("INSERT ERROR:", insertError);
      return res.status(400).json({ error: insertError.message });
    }

    res.json({ message: 'Approved + listing created' });

  } catch (err) {
    console.error("FULL ERROR:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reject request
router.patch('/litter-requests/:id/reject', adminAuth, async (req, res) => {
  const { error } = await supabase
    .from('litter_requests')
    .update({ status: 'rejected' })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Litter rejected!' });
});

module.exports = router;
module.exports.adminAuth = adminAuth;