const multer = require('multer');
const upload = multer();
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const approvedBreederMiddleware = require('../middleware/approvedBreeder');

// const multer = require('multer');
// const upload = multer();
// 🔹 GET ALL BREEDERS (FEATURE PAGE)
router.get('/', async (req, res) => {
  try {
    const { state } = req.query;

    let query = supabase
      .from('breeder_profiles')
      .select(`
        id,
        breeder_name,
        business_name,
        state,
        city,
        bio,
        email,
        phone,
        website,
        profile_image,
        social_facebook,
        social_instagram,
        social_twitter,
        is_featured,
        is_approved
      `)
      .eq('is_approved', true)
      .order('is_featured', { ascending: false });

    if (state) {
      query = query.eq('state', state);
    }

    const { data, error } = await query;

    if (error) {
      console.error("BREEDER FETCH ERROR:", error);
      return res.status(400).json({ error: error.message });
    }

    const featured = data.filter(b => b.is_featured);
    const normal = data.filter(b => !b.is_featured);

    res.json({
      featured,
      normal
    });

  } catch (err) {
    console.error("BREEDER ROUTE ERROR:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my-requests', async (req, res) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: userData } = await supabase.auth.getUser(token);

  const { data } = await supabase
    .from('litter_requests')
    .select('*')
    .eq('user_id', userData.user.id);

  res.json({ requests: data || [] });
});

router.get('/meta/states', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('breeder_profiles')
      .select('state')
      .eq('is_approved', true)
      .not('state', 'is', null);

    if (error) throw error;

    const states = [...new Set(data.map(d => d.state))]
      .filter(Boolean)
      .sort();

    res.json({ states });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load states' });
  }
});

router.post('/schedule-litter', authMiddleware, approvedBreederMiddleware, upload.array('photos'), async (req, res) => {
  try {
    const user = req.user;
    const files = req.files;

let imageUrls = [];

if (files && files.length > 0) {
  for (let file of files) {
    const fileName = `${Date.now()}-${Math.random()}-${file.originalname}`;

    const { data, error } = await supabase.storage
      .from('pomsky-images') // 👈 create this bucket
      .upload(fileName, file.buffer, {
        contentType: file.mimetype
      });

    if (error) {
  console.error("❌ IMAGE UPLOAD ERROR:", error);
} else {
  const { data: publicUrl } = supabase
    .storage
    .from('pomsky-images')
    .getPublicUrl(fileName);

  imageUrls.push(publicUrl.publicUrl);
}
  }
}

    const { name, kennel, message, url, date, availability, puppies_available, state, price_min, price_max, next_litter, pomsky_type, gender, markings, contact_email, contact_phone,} = req.body;

    const { error: insertError } = await supabase
  .from('litter_requests')
  .insert({
    user_id: user.id,
    name,
    kennel,
    message,
    url,
    date,
    status: 'pending',
    availability,
    puppies_available,
    state,
    price_min,
    price_max,
    next_litter,
    pomsky_type,
    gender,
    markings,
    contact_email,
    contact_phone,
    images: imageUrls,
  });

if (insertError) {
  console.error("❌ INSERT ERROR:", insertError);
  return res.status(400).json({ error: insertError.message });
}

    res.json({ message: 'Submitted successfully' });
    console.log("FILES:", req.files);
console.log("UPLOAD URLS:", imageUrls);

  } catch (err) {
    console.error("FULL ERROR:", err);
console.error("STACK:", err.stack);
    res.status(500).json({ error: 'Server error' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // Fetch breeder profile
    const { data: profile, error: profileError } = await supabase
      .from('breeder_profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) return res.status(404).json({ error: 'Breeder not found' });

    // Fetch breeder's listings
    const { data: listings, error: listingsError } = await supabase
      .from('pomsky_listings')
      .select('*')
      .eq('breeder_id', id)
      .eq('is_active', true);

    if (listingsError) throw listingsError;

    res.json({
      profile,
      listings: listings || []
    });

  } catch (err) {
    console.error("SINGLE BREEDER FETCH ERROR:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;