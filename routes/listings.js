const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

// GET listings — free users see limited, paid see all
router.get('/', async (req, res) => {
  const { state, gender, type, availability, min_price, max_price, new_litter, limit = 50 } = req.query;

  let query = supabase
    .from('pomsky_listings')
    .select(`
      id, name, gender, pomsky_type, markings, price,
      availability, is_new_litter, state, city, country,
      images, is_featured, created_at,
      breeder_profiles (
        id, breeder_name, business_name, state, city,
        profile_image, is_featured, is_approved
      )
    `)
    .eq('is_active', true)
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false });

  // Apply filters
  if (state) query = query.eq('state', state);
  if (gender) query = query.eq('gender', gender);
  if (type) query = query.eq('pomsky_type', type);
  if (availability) query = query.eq('availability', availability);
  if (new_litter === 'true') query = query.eq('is_new_litter', true);
  if (min_price) query = query.gte('price', parseFloat(min_price));
  if (max_price) query = query.lte('price', parseFloat(max_price));

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  // Check if user is logged in and has paid membership
  let isPaidMember = false;
  const token = req.cookies.token;

  if (token) {
    const { data: userData } = await supabase.auth.getUser(token);
    if (userData?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('membership_type')
        .eq('id', userData.user.id)
        .maybeSingle();

      const paidTypes = ['shopper_monthly', 'shopper_lifetime', 'owner_monthly', 'owner_annual', 'breeder_free', 'breeder_silver', 'breeder_gold'];
      isPaidMember = paidTypes.includes(profile?.membership_type);
    }
  }

  // Free users see only first 6 listings with blurred images
  const FREE_LIMIT = 6;
  let listings = data || [];

  if (!isPaidMember) {
    const visible = listings.slice(0, FREE_LIMIT);
    const locked  = listings.slice(FREE_LIMIT).map(l => ({
      ...l,
      name: 'Members Only',
      images: [],
      price: null,
      city: '***',
      is_locked: true
    }));
    listings = [...visible, ...locked];
  }

  res.json({
    listings,
    total: data?.length || 0,
    visible: isPaidMember ? data?.length : FREE_LIMIT,
    is_paid_member: isPaidMember
  });
});

// GET single listing
router.get('/:id', async (req, res) => {
  const token = req.cookies.token;
  let isPaidMember = false;

  if (token) {
    const { data: userData } = await supabase.auth.getUser(token);
    if (userData?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('membership_type')
        .eq('id', userData.user.id)
        .maybeSingle();

      const paidTypes = ['shopper_monthly', 'shopper_lifetime', 'owner_monthly', 'owner_annual', 'breeder_free', 'breeder_silver', 'breeder_gold'];
      isPaidMember = paidTypes.includes(profile?.membership_type);
    }
  }

  const { data, error } = await supabase
    .from('pomsky_listings')
    .select(`*, breeder_profiles(*)`)
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Listing not found' });
  if (!isPaidMember) return res.status(403).json({ error: 'Paid membership required' });

  res.json({ listing: data });
});

// GET all US states for filter
router.get('/meta/states', async (req, res) => {
  const { data, error } = await supabase
    .from('pomsky_listings')
    .select('state')
    .eq('is_active', true)
    .not('state', 'is', null);

  if (error) return res.status(400).json({ error: error.message });

  const states = [...new Set(data.map(d => d.state))].filter(Boolean).sort();
  res.json({ states });
});

module.exports = router;