// routes/membership.js
const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { triggerMembershipTagById } = require('../utils/activecampaign');

// Upgrade membership after payment
router.post('/upgrade', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;

  const validTypes = [
    'owner', 'owner_monthly', 'owner_annual', 'owner_free',
    'breeder_free', 'breeder_silver', 'breeder_gold',
    'shopper_monthly', 'shopper_lifetime', 'shopper_free'
  ];

  if (!validTypes.includes(membership_type)) {
    return res.status(400).json({ error: 'Invalid membership type' });
  }

  const updateData = {
    membership_type
  };

  if (membership_type.startsWith('breeder_')) {
    updateData.membership_breeder = membership_type;
    updateData.status_breeder = 'active';
    updateData.account_type = 'breeder';

    // If they upgrade to breeder_free, they must complete onboarding
    if (membership_type === 'breeder_free') {
      updateData.needs_onboarding = true;
    }
  } else if (membership_type.startsWith('owner_') || membership_type === 'owner') {
    updateData.membership_owner = membership_type === 'owner' ? 'owner_monthly' : membership_type;
    updateData.status_owner = 'active';
    updateData.account_type = 'owner';
  } else if (membership_type.startsWith('shopper_')) {
    updateData.membership_shopper = membership_type;
    updateData.status_shopper = 'active';
    updateData.account_type = 'shopper';
  }

  const { error } = await supabase
    .from('profiles')
    .update(updateData)
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

  if (!profile) {
    return res.status(400).json({ error: 'Profile not found' });
  }

  // Downgrade to correct free tier based on account type
  const category = profile.account_type === 'breeder' ? 'breeder' :
                   profile.account_type === 'owner' ? 'owner' : 'shopper';
  const freeTier = `${category}_free`;

  const { error } = await supabase
    .from('profiles')
    .update({
      membership_type: freeTier,
      [`membership_${category}`]: freeTier,
      [`status_${category}`]: 'cancelled',
      [`sub_id_${category}`]: null
    })
    .eq('id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Downgraded to free tier' });
});

module.exports = router;