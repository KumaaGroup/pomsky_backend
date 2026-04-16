const multer = require('multer');
const upload = multer();
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// const multer = require('multer');
// const upload = multer();

router.post('/schedule-litter', upload.array('photos'), async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData || !userData.user) {
  return res.status(401).json({ error: 'Invalid user' });
}

const user = userData.user;

    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_type')
      .eq('id', user.id)
      .single();

    if (!profile) {
  return res.status(400).json({ error: 'Profile not found' });
}

if (profile.membership_type !== 'breeder_gold') {
  return res.status(403).json({ error: 'Only Gold members allowed' });
}

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

    const startOfMonth = new Date();
    startOfMonth.setDate(1);

    const { data: existing } = await supabase
      .from('litter_requests')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', startOfMonth.toISOString());

    if ((existing || []).length >= 1) {
      return res.status(400).json({
        error: 'You can only submit one litter per month'
      });
    }

    await supabase.from('litter_requests').insert({
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

  } catch (err) {
    console.error("🔥 FULL ERROR:", err);
console.error("🔥 STACK:", err.stack);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my-requests', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: userData } = await supabase.auth.getUser(token);

  const { data } = await supabase
    .from('litter_requests')
    .select('*')
    .eq('user_id', userData.user.id);

  res.json({ requests: data || [] });
});

module.exports = router;