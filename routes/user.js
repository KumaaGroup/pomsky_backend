const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

// Helper: wrap a value in an array if it isn't already one
// Social links & images come from multipart forms as strings, DB expects text[]
const toArray = (v) => {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  return [v]; // single string → single-element array
};

// Update account details
router.post('/update-account', authMiddleware, async (req, res) => {
  const { full_name, email } = req.body;
  const userId = req.user.id;

  const { error } = await supabase
    .from('profiles')
    .update({ full_name, email })
    .eq('id', userId);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Account updated successfully!' });
});

// Change password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { new_password } = req.body;

  const { error } = await supabase.auth.admin.updateUserById(
    req.user.id,
    { password: new_password }
  );

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Password changed successfully!' });
});

// Add billing address
router.post('/billing-address', authMiddleware, async (req, res) => {
  const { first_name, last_name, address_line1, address_line2, city, state, zip_code, country } = req.body;

  await supabase
    .from('billing_addresses')
    .update({ is_default: false })
    .eq('user_id', req.user.id);

  const { data, error } = await supabase
    .from('billing_addresses')
    .insert({
      user_id: req.user.id,
      first_name, last_name, address_line1, address_line2,
      city, state, zip_code, country: country || 'US',
      is_default: true
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Billing address saved!', address: data });
});

// Add shipping address
router.post('/shipping-address', authMiddleware, async (req, res) => {
  const { first_name, last_name, address_line1, address_line2, city, state, zip_code, country } = req.body;

  await supabase
    .from('shipping_addresses')
    .update({ is_default: false })
    .eq('user_id', req.user.id);

  const { data, error } = await supabase
    .from('shipping_addresses')
    .insert({
      user_id: req.user.id,
      first_name, last_name, address_line1, address_line2,
      city, state, zip_code, country: country || 'US',
      is_default: true
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Shipping address saved!', address: data });
});

// Delete billing address
router.delete('/billing-address/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('billing_addresses')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Address deleted!' });
});

// Delete shipping address
router.delete('/shipping-address/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('shipping_addresses')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Address deleted!' });
});

// ── Breeder Profile ──

// Save or update breeder profile
router.post('/breeder-profile', authMiddleware, async (req, res) => {
  const {
    breeder_name, business_name, state, city, country, phone, email,
    website, bio, profile_image,
    social_facebook, social_instagram, social_twitter
  } = req.body;

  if (!breeder_name) return res.status(400).json({ error: 'Breeder name is required' });

  const { data: existing } = await supabase
    .from('breeder_profiles')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  const payload = {
    breeder_name, business_name, state, city, country: country || 'US',
    phone, email, website, bio, profile_image,
    social_facebook, social_instagram, social_twitter
  };

  let result;
  if (existing) {
    result = await supabase
      .from('breeder_profiles')
      .update(payload)
      .eq('user_id', req.user.id)
      .select()
      .single();
  } else {
    result = await supabase
      .from('breeder_profiles')
      .insert({ user_id: req.user.id, ...payload })
      .select()
      .single();
  }

  if (result.error) return res.status(400).json({ error: result.error.message });
  res.json({ message: 'Breeder profile saved!', profile: result.data });
});

// Get breeder profile
router.get('/breeder-profile', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('breeder_profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ profile: data });
});

// ── Pomsky Listings ──

// Add a new listing
router.post('/listings', authMiddleware, async (req, res) => {
  const {
    name, gender, pomsky_type, markings,
    price, availability, state, city,
    images, description, birth_date, is_new_litter
  } = req.body;

  // Get breeder profile first
  const { data: breeder } = await supabase
    .from('breeder_profiles')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!breeder) {
    return res.status(400).json({ error: 'Please set up your breeder profile first' });
  }

  const { data, error } = await supabase
    .from('pomsky_listings')
    .insert({
      breeder_id: breeder.id,
      user_id: req.user.id,
      name, gender, pomsky_type, markings,
      price, availability: availability || 'available',
      state, city,
      images: images || [],
      description, birth_date,
      is_new_litter: is_new_litter || false
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Listing added!', listing: data });
});

// Get breeder's own listings
router.get('/my-listings', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('pomsky_listings')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ listings: data });
});

// Update a listing (supports multipart/form-data for image uploads)
router.patch('/listings/:id', authMiddleware, upload.array('new_images'), async (req, res) => {
  const {
    name, gender, pomsky_type, markings,
    price, availability, state, city,
    description, is_new_litter,
    existing_images  // JSON string of image URLs to keep
  } = req.body;

  // Upload any new image files to Supabase Storage
  let uploadedUrls = [];
  const files = req.files || [];
  for (const file of files) {
    const fileName = `listings/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('pomsky-images')
      .upload(fileName, file.buffer, { contentType: file.mimetype });
    if (!uploadError) {
      const { data: pub } = supabase.storage.from('pomsky-images').getPublicUrl(fileName);
      uploadedUrls.push(pub.publicUrl);
    } else {
      console.error('LISTING IMAGE UPLOAD ERROR:', uploadError);
    }
  }

  // Merge kept existing images + newly uploaded images
  let keptImages = [];
  if (existing_images) {
    try { keptImages = JSON.parse(existing_images); } catch { keptImages = []; }
  }
  const finalImages = [...keptImages, ...uploadedUrls];

  const payload = {
    name, gender, pomsky_type, markings,
    price: price ? Number(price) : null,
    availability, state, city,
    images: finalImages,
    description,
    is_new_litter: is_new_litter === 'true' || is_new_litter === true
  };

  // Strip undefined values so we don't accidentally null out fields
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  const { error } = await supabase
    .from('pomsky_listings')
    .update(payload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id); // ensure they own it

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Listing updated!' });
});

// Delete a listing
router.delete('/listings/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('pomsky_listings')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Listing deleted!' });
});

// Complete breeder onboarding
// Accepts multipart/form-data so the breeder can upload a profile image directly
router.post('/complete-onboarding', authMiddleware, upload.array('profile_image'), async (req, res) => {
  const {
    breeder_name, business_name,
    state, city, country,
    phone, email,
    website, bio,
    social_facebook, social_instagram, social_twitter
  } = req.body;

  // ── Upload profile images to Supabase Storage ──
  let profileImageUrls = [];
  const files = req.files || [];
  for (const file of files) {
    const fileName = `breeder-profiles/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('pomsky-images')
      .upload(fileName, file.buffer, { contentType: file.mimetype });
    if (uploadError) {
      console.error('PROFILE IMAGE UPLOAD ERROR:', uploadError);
    } else {
      const { data: pub } = supabase.storage.from('pomsky-images').getPublicUrl(fileName);
      profileImageUrls.push(pub.publicUrl);
    }
  }
  // If no new image uploaded, fall back to any URL(s) sent as plain text field
  if (profileImageUrls.length === 0 && req.body.profile_image_url) {
    profileImageUrls = toArray(req.body.profile_image_url);
  }

  if (!breeder_name) {
    return res.status(400).json({ error: 'Breeder name required' });
  }

  const { data: breederProfile, error: fetchError } = await supabase
    .from('breeder_profiles')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (fetchError) {
    console.error(fetchError);
    return res.status(500).json({ error: fetchError.message });
  }

  // Save full request data so admin can approve with complete info
  const { error: requestError } = await supabase
    .from('breeder_requests')
    .insert({
      user_id: req.user.id,
      breeder_name,
      business_name,
      state,
      city,
      country: country || 'US',
      phone,
      email,
      website,
      bio,
      profile_image: profileImageUrls.length > 0 ? profileImageUrls : null,  // text[]
      social_facebook:  toArray(social_facebook),   // text[]
      social_instagram: toArray(social_instagram),  // text[]
      social_twitter:   toArray(social_twitter),    // text[]
      status: 'pending'
    });

  if (requestError) {
    console.error(requestError);
    return res.status(400).json({ error: requestError.message });
  }

  // Also pre-populate the breeder_profile (unapproved) so data is ready on approval
  const breederProfilePayload = {
    breeder_name,
    business_name,
    state,
    city,
    country: country || 'US',
    phone,
    email,
    website,
    bio,
    profile_image: profileImageUrls.length > 0 ? profileImageUrls : null,  // text[]
    social_facebook:  toArray(social_facebook),   // text[]
    social_instagram: toArray(social_instagram),  // text[]
    social_twitter:   toArray(social_twitter),    // text[]
    is_onboarded: true,
    is_approved: false
  };

  if (breederProfile) {
    const { error: updateError } = await supabase
      .from('breeder_profiles')
      .update(breederProfilePayload)
      .eq('user_id', req.user.id);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: updateError.message });
    }
  } else {
    const { error: insertError } = await supabase
      .from('breeder_profiles')
      .insert({
        user_id: req.user.id,
        ...breederProfilePayload
      });

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: insertError.message });
    }
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ needs_onboarding: false })
    .eq('id', req.user.id);

  if (profileError) {
    console.error(profileError);
    return res.status(500).json({ error: profileError.message });
  }

  res.json({ message: 'Request submitted for approval' });
});

// Check onboarding status
router.get('/onboarding-status', authMiddleware, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_type, account_type')
    .eq('id', req.user.id)
    .maybeSingle();

  const { data: breeder } = await supabase
    .from('breeder_profiles')
    .select('is_onboarded, breeder_name, business_name')
    .eq('user_id', req.user.id)
    .maybeSingle();

  const isBreeder = profile?.membership_type === 'breeder_silver' ||
                    profile?.membership_type === 'breeder_gold' ||
                    profile?.membership_type === 'breeder_free';

  res.json({
    is_breeder: isBreeder,
    is_onboarded: breeder?.is_onboarded || false,
    membership_type: profile?.membership_type,
    breeder_name: breeder?.breeder_name || null
  });
});

module.exports = router;