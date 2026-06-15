const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const approvedBreederMiddleware = require('../middleware/approvedBreeder');
const { sendEmail } = require('../utils/email');

// ── Membership Management Helpers ──

/**
 * Determine which profile columns to update based on membership_type prefix.
 * e.g. 'shopper_monthly' → { statusCol: 'status_shopper', subIdCol: 'sub_id_shopper' }
 */
function getMembershipCols(membership_type) {
  if (!membership_type) return null;
  if (membership_type.startsWith('shopper_')) return { statusCol: 'status_shopper', subIdCol: 'sub_id_shopper' };
  if (membership_type.startsWith('breeder_')) return { statusCol: 'status_breeder', subIdCol: 'sub_id_breeder' };
  if (membership_type.startsWith('owner_'))   return { statusCol: 'status_owner',   subIdCol: 'sub_id_owner' };
  return null;
}

// Pause membership
router.post('/membership/pause', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;
  const cols = getMembershipCols(membership_type);
  if (!cols) return res.status(400).json({ error: 'Invalid membership type' });

  // Fetch current subscription ID (for Stripe)
  const { data: profile, error: fetchErr } = await supabase
    .from('profiles')
    .select(`${cols.subIdCol}`)
    .eq('id', req.user.id)
    .single();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  // Update status in DB
  const { error } = await supabase
    .from('profiles')
    .update({ [cols.statusCol]: 'paused' })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  // Optionally pause Stripe subscription if sub ID exists
  const subId = profile[cols.subIdCol];
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.update(subId, {
        pause_collection: { behavior: 'void' }
      });
    } catch (stripeErr) {
      console.warn('Stripe pause warning (status updated in DB):', stripeErr.message);
    }
  }

  res.json({ message: 'Membership paused successfully' });
});

// Cancel membership
router.post('/membership/cancel', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;
  const cols = getMembershipCols(membership_type);
  if (!cols) return res.status(400).json({ error: 'Invalid membership type' });

  // Fetch current subscription ID (for Stripe)
  const { data: profile, error: fetchErr } = await supabase
    .from('profiles')
    .select(`${cols.subIdCol}`)
    .eq('id', req.user.id)
    .single();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  // Update status to 'cancelling' (keeps access until end of billing period)
  const { error } = await supabase
    .from('profiles')
    .update({ [cols.statusCol]: 'cancelling' })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  // Cancel at period end in Stripe if sub ID exists
  const subId = profile[cols.subIdCol];
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    } catch (stripeErr) {
      console.warn('Stripe cancel warning (status updated in DB):', stripeErr.message);
    }
  }

  res.json({ message: 'Membership cancellation scheduled' });
});

// Resume membership (from paused)
router.post('/membership/resume', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;
  const cols = getMembershipCols(membership_type);
  if (!cols) return res.status(400).json({ error: 'Invalid membership type' });

  // Fetch current subscription ID (for Stripe)
  const { data: profile, error: fetchErr } = await supabase
    .from('profiles')
    .select(`${cols.subIdCol}`)
    .eq('id', req.user.id)
    .single();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const { error } = await supabase
    .from('profiles')
    .update({ [cols.statusCol]: 'active' })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  // Resume Stripe subscription if sub ID exists
  const subId = profile[cols.subIdCol];
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.update(subId, { pause_collection: '' });
    } catch (stripeErr) {
      console.warn('Stripe resume warning (status updated in DB):', stripeErr.message);
    }
  }

  res.json({ message: 'Membership resumed successfully' });
});

// Reactivate membership (from cancelling state)
router.post('/membership/reactivate', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;
  const cols = getMembershipCols(membership_type);
  if (!cols) return res.status(400).json({ error: 'Invalid membership type' });

  // Fetch current subscription ID (for Stripe)
  const { data: profile, error: fetchErr } = await supabase
    .from('profiles')
    .select(`${cols.subIdCol}`)
    .eq('id', req.user.id)
    .single();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const { error } = await supabase
    .from('profiles')
    .update({ [cols.statusCol]: 'active' })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  // Re-enable Stripe subscription (undo cancel_at_period_end) if sub ID exists
  const subId = profile[cols.subIdCol];
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.update(subId, { cancel_at_period_end: false });
    } catch (stripeErr) {
      console.warn('Stripe reactivate warning (status updated in DB):', stripeErr.message);
    }
  }

  res.json({ message: 'Membership reactivated successfully' });
});

// Helper: wrap a value in an array if it isn't already one.
// Handles comma-separated values for fields like photos or multiple socials.
const toArray = (v) => {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [v];
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
    website, bio, profile_image, kennel_logo_url,
    social_facebook, social_instagram, social_twitter, social_youtube, social_other,
    available_pomskies_info, price_range, what_is_included,
    health_tests, vet_reference,
    testimonial_1, testimonial_2, testimonial_3,
    apkc_member_status, apkc_proof_url,
    ipa_member_status, ipa_proof_url,
    good_dog_member_status, good_dog_proof_url,
    non_member_action, disclosure, other_comments,
    agreed_code_of_ethics, kennel_photos_urls
  } = req.body;

  if (!breeder_name) return res.status(400).json({ error: 'Breeder name is required' });

  const { data: existing } = await supabase
    .from('breeder_profiles')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  const payload = {
    breeder_name, business_name, state, city, country: country || 'US',
    phone, email, website, bio,
    // profile_image is text[] in Postgres — must be an array, not a plain string
    profile_image:      toArray(profile_image),
    kennel_logo_url:    kennel_logo_url || null,
    
    // Arrays in database (need toArray)
    social_facebook:    toArray(social_facebook),
    social_instagram:   toArray(social_instagram),
    social_twitter:     toArray(social_twitter),
    kennel_photos_urls: toArray(kennel_photos_urls),

    // Strings in database
    social_youtube: social_youtube || null,
    social_other:   social_other || null,
    
    available_pomskies_info, price_range, what_is_included,
    health_tests, vet_reference,
    
    testimonial_1, testimonial_2, testimonial_3,
    
    apkc_member_status,
    apkc_proof_url: apkc_proof_url || null,
    ipa_member_status,
    ipa_proof_url: ipa_proof_url || null,
    good_dog_member_status,
    good_dog_proof_url: good_dog_proof_url || null,
    
    non_member_action, disclosure, other_comments,
    agreed_code_of_ethics: agreed_code_of_ethics === 'true' || agreed_code_of_ethics === true
  };

  // Strip undefined and empty strings so we don't corrupt existing data
  Object.keys(payload).forEach(k => {
    if (payload[k] === undefined) delete payload[k];
    if (payload[k] === '') payload[k] = null; // treat empty string as null for text fields
  });

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

  if (result.error) {
    console.error('BREEDER PROFILE SAVE ERROR:', result.error);
    return res.status(400).json({ error: result.error.message });
  }
  res.json({ message: 'Breeder profile saved!', profile: result.data });
});

// Get breeder profile
router.get('/breeder-profile', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('breeder_profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) {
    console.error('BREEDER PROFILE FETCH ERROR:', error);
    return res.status(400).json({ error: error.message });
  }
  // data is null if no profile exists yet — return empty profile gracefully
  res.json({ profile: data || null });
});

// ── Pomsky Listings ──

// Add a new listing
router.post('/listings', authMiddleware, approvedBreederMiddleware, async (req, res) => {
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

  // Notify Admin
  sendEmail({
    to: process.env.GMAIL_USER,
    subject: `🐾 New Litter Listing: ${name}`,
    html: `
      <h2>New Litter Listing Submitted</h2>
      <p><strong>Breeder:</strong> ${req.user.email}</p>
      <p><strong>Litter Name:</strong> ${name}</p>
      <p><strong>Type:</strong> ${pomsky_type}</p>
      <p><strong>Price:</strong> $${price}</p>
      <p><a href="${process.env.FRONTEND_URL}/admin">Review in Admin Panel</a></p>
    `
  });

  res.json({ message: 'Listing added!', listing: data });
});

// Get breeder's own listings
router.get('/my-listings', authMiddleware, approvedBreederMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('pomsky_listings')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ listings: data });
});

// Update a listing (supports multipart/form-data for image uploads)
router.patch('/listings/:id', authMiddleware, approvedBreederMiddleware, upload.array('new_images'), async (req, res) => {
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
router.delete('/listings/:id', authMiddleware, approvedBreederMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('pomsky_listings')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Listing deleted!' });
});

// Complete breeder onboarding
router.post('/complete-onboarding', authMiddleware, upload.any(), async (req, res) => {
  const {
    breeder_name, business_name,
    state, city, country,
    phone, email,
    website, bio,
    social_facebook, social_instagram, social_twitter, social_youtube, social_other,
    apkc_member_status, ipa_member_status, good_dog_member_status,
    non_member_action, available_pomskies_info, price_range,
    what_is_included, vet_reference, health_tests,
    testimonial_1, testimonial_2, testimonial_3,
    disclosure, other_comments, agreed_code_of_ethics
  } = req.body;

  // ── Upload files to Supabase Storage ──
  const files = req.files || [];
  const uploads = {
    apkc_proof_url: null,
    ipa_proof_url: null,
    good_dog_proof_url: null,
    kennel_logo_url: null,
    kennel_photos_urls: []
  };

  for (const file of files) {
    const fileName = `onboarding/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('pomsky-images')
      .upload(fileName, file.buffer, { contentType: file.mimetype });
    
    if (!uploadError) {
      const { data: pub } = supabase.storage.from('pomsky-images').getPublicUrl(fileName);
      
      // Match the file field name
      if (file.fieldname === 'apkc_proof') uploads.apkc_proof_url = pub.publicUrl;
      else if (file.fieldname === 'ipa_proof') uploads.ipa_proof_url = pub.publicUrl;
      else if (file.fieldname === 'good_dog_proof') uploads.good_dog_proof_url = pub.publicUrl;
      else if (file.fieldname === 'kennel_logo') uploads.kennel_logo_url = pub.publicUrl;
      else if (file.fieldname === 'kennel_photos') uploads.kennel_photos_urls.push(pub.publicUrl);
    } else {
      console.error('FILE UPLOAD ERROR:', uploadError);
    }
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

  const payload = {
    breeder_name,
    business_name,
    state,
    city,
    country: country || 'US',
    phone,
    email,
    website,
    bio,
    social_facebook:  toArray(social_facebook),
    social_instagram: toArray(social_instagram),
    social_twitter:   toArray(social_twitter),
    social_youtube:   social_youtube || null,
    social_other:     social_other || null,
    apkc_member_status,
    ipa_member_status,
    good_dog_member_status,
    non_member_action,
    available_pomskies_info,
    price_range,
    what_is_included,
    vet_reference,
    health_tests,
    testimonial_1,
    testimonial_2,
    testimonial_3,
    disclosure,
    other_comments,
    agreed_code_of_ethics: agreed_code_of_ethics === 'true' || agreed_code_of_ethics === true,
    apkc_proof_url: uploads.apkc_proof_url,
    ipa_proof_url: uploads.ipa_proof_url,
    good_dog_proof_url: uploads.good_dog_proof_url,
    kennel_logo_url: uploads.kennel_logo_url,
    kennel_photos_urls: uploads.kennel_photos_urls
  };

  // Save full request data so admin can review
  const { error: requestError } = await supabase
    .from('breeder_requests')
    .insert({
      user_id: req.user.id,
      status: 'pending',
      ...payload
    });

  if (requestError) {
    console.error(requestError);
    return res.status(400).json({ error: requestError.message });
  }

  // Pre-populate the breeder_profile (unapproved)
  const profilePayload = {
    ...payload,
    is_onboarded: true,
    is_approved: false
  };

  if (breederProfile) {
    const { error: updateError } = await supabase
      .from('breeder_profiles')
      .update(profilePayload)
      .eq('user_id', req.user.id);
    if (updateError) return res.status(500).json({ error: updateError.message });
  } else {
    const { error: insertError } = await supabase
      .from('breeder_profiles')
      .insert({ user_id: req.user.id, ...profilePayload });
    if (insertError) return res.status(500).json({ error: insertError.message });
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ needs_onboarding: false })
    .eq('id', req.user.id);

  if (profileError) return res.status(500).json({ error: profileError.message });

  // Notify Admin
  sendEmail({
    to: process.env.GMAIL_USER,
    subject: `📢 New Breeder Onboarding: ${business_name || breeder_name}`,
    html: `
      <h2>New Breeder Application</h2>
      <p><strong>Business:</strong> ${business_name || 'N/A'}</p>
      <p><strong>Breeder Name:</strong> ${breeder_name}</p>
      <p><strong>Location:</strong> ${city}, ${state}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><a href="${process.env.FRONTEND_URL}/admin">Review in Admin Panel</a></p>
    `
  });

  res.json({ message: 'Request submitted for approval' });
});

// Check onboarding status
router.get('/onboarding-status', authMiddleware, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_type, membership_breeder, account_type')
    .eq('id', req.user.id)
    .maybeSingle();

  const { data: breeder } = await supabase
    .from('breeder_profiles')
    .select('is_onboarded, is_approved, breeder_name, business_name')
    .eq('user_id', req.user.id)
    .maybeSingle();

  const membership = profile?.membership_breeder || profile?.membership_type || 'shopper_free';
  const isBreeder = membership.startsWith('breeder_');

  res.json({
    is_breeder: isBreeder,
    is_onboarded: breeder?.is_onboarded || false,
    is_approved: breeder?.is_approved || false,
    membership_type: membership,
    breeder_name: breeder?.breeder_name || null
  });
});

module.exports = router;