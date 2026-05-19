// routes/membership.js
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { triggerMembershipTagById } = require('../utils/activecampaign');

// Upgrade membership after payment
router.post('/upgrade', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;

  const validTypes = ['owner', 'breeder_silver', 'breeder_gold'];

  if (!validTypes.includes(membership_type)) {
    return res.status(400).json({ error: 'Invalid membership type' });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ membership_type })
    .eq('id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });

  // Trigger ActiveCampaign tagging for manual upgrade
  try {
    await triggerMembershipTagById(req.user.id, membership_type);
  } catch (acErr) {
    console.error('ActiveCampaign manual upgrade tagging error:', acErr.message);
  }

  res.json({ message: `Upgraded to ${membership_type} successfully!` });
});

// Downgrade to free (when subscription cancelled)
router.post('/downgrade', authMiddleware, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_type')
    .eq('id', req.user.id)
    .single();

  // Downgrade to correct free tier based on account type
  const freeTier = profile.account_type === 'breeder' ? 'breeder_free' : 'shopper';

  const { error } = await supabase
    .from('profiles')
    .update({ membership_type: freeTier })
    .eq('id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Downgraded to free tier' });
});

module.exports = router;