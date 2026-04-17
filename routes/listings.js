const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

/* ================================
   🔹 GET META (MUST BE FIRST)
================================ */
router.get('/meta/states', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pomsky_listings')
      .select('state')
      .eq('is_active', true)
      .not('state', 'is', null);

    if (error) {
      console.error("META ERROR:", error);
      return res.status(400).json({ error: error.message });
    }

    const states = [...new Set(data.map(d => d.state))]
      .filter(Boolean)
      .sort();

    res.json({ states });

  } catch (err) {
    console.error("META CATCH ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   🔹 GET ALL LISTINGS
================================ */
router.get('/', async (req, res) => {
  try {
    const { state, gender, type, availability, min_price, max_price, new_litter } = req.query;

    let query = supabase
      .from('pomsky_listings')
      .select(`
  id, breeder_id, name, gender, pomsky_type, markings, price,
  availability, state, city, country,
  images, description,
  contact_email, contact_phone,
  is_featured, created_at,
  breeder_profiles (
    id, breeder_name, business_name, state, city
  )
`)
      .eq('is_active', true)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false });

    if (state) query = query.eq('state', state);
    if (gender) query = query.eq('gender', gender);
    if (type) query = query.eq('pomsky_type', type);
    if (availability) query = query.eq('availability', availability);
    if (new_litter === 'true') query = query.eq('is_new_litter', true);
    if (min_price) query = query.gte('price', Number(min_price));
    if (max_price) query = query.lte('price', Number(max_price));

    const { data, error } = await query;

    if (error) {
      console.error("LISTINGS ERROR:", error);
      return res.status(400).json({ error: error.message });
    }

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

        const paidTypes = [
          'shopper_monthly', 'shopper_lifetime',
          'owner_monthly', 'owner_annual',
          'breeder_free', 'breeder_silver', 'breeder_gold'
        ];

        isPaidMember = paidTypes.includes(profile?.membership_type);
      }
    }

    const FREE_LIMIT = 6;
    let listings = data || [];

    if (!isPaidMember) {
      const visible = listings.slice(0, FREE_LIMIT);
      const locked = listings.slice(FREE_LIMIT).map(l => ({
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

  } catch (err) {
    console.error("LISTINGS CATCH ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   🔹 GET SINGLE LISTING (LAST!)
================================ */
// 🔹 UPDATE LISTING
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id.trim();
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 🔹 Get logged-in user
    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData?.user) {
      return res.status(401).json({ error: "Invalid user" });
    }

    const userId = userData.user.id;

    // 🔹 Fetch listing
    const { data: listing } = await supabase
      .from('pomsky_listings')
      .select('id, breeder_id')
      .eq('id', id)
      .maybeSingle();

    if (!listing) {
      return res.status(404).json({ error: "Listing not found" });
    }

    // 🔥 CRITICAL CHECK
    if (listing.breeder_id !== userId) {
      return res.status(403).json({ error: "You don't own this listing" });
    }

    // 🔹 Allowed fields
    const {
      name, price, state, city,
      description, images,
      gender, pomsky_type, markings,
      contact_email, contact_phone
    } = req.body;

    const { data, error } = await supabase
      .from('pomsky_listings')
      .update({
        name,
        price,
        state,
        city,
        description,
        images,
        gender,
        pomsky_type,
        markings,
        contact_email,
        contact_phone
      })
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true, data });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;