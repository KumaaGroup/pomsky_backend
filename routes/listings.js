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
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id.trim(); // 🔥 important fix

    console.log("FETCHING LISTING ID:", id);
    console.log("RAW PARAM:", req.params.id);
console.log("LENGTH:", req.params.id.length);
console.log("CHARS:", [...req.params.id]);

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

        const paidTypes = [
          'shopper_monthly', 'shopper_lifetime',
          'owner_monthly', 'owner_annual',
          'breeder_free', 'breeder_silver', 'breeder_gold'
        ];

        isPaidMember = paidTypes.includes(profile?.membership_type);
      }
    }

    const { data, error } = await supabase
      .from('pomsky_listings')
      .select(`
        id, name, gender, pomsky_type, markings, price,
        availability, state, city, images,
       contact_email, contact_phone,
        description, birth_date, is_new_litter, created_at,
        breeder_profiles (
          breeder_name, business_name, state, city, phone, website
        )
      `)
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle(); // 🔥 safer than single()

    console.log("DB RESULT:", data);
    console.log("DB ERROR:", error);

    if (!data) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (!isPaidMember) {
      return res.json({
        listing: {
          ...data,
          images: [],
          contact_email: null,
          contact_phone: null
        },
        locked: true
      });
    }

    res.json({ listing: data });

  } catch (err) {
    console.error("SINGLE LISTING ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;