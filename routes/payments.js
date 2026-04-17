const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

// ── Replace with your actual Stripe Price IDs ──
const PRICE_IDS = {
  shopper_monthly:  'price_1TM03FQX4ubgjBMW3GI2wasi',  // $2.99/mo
  shopper_lifetime: 'price_1TM04rQX4ubgjBMWZfcnJf3z',  // $14.99 one-time
  owner_monthly:    'price_1TM08cQX4ubgjBMWA0z5evBF',  // $20/mo
  owner_annual:     'price_1TM09BQX4ubgjBMWM261z1os',  // $200/yr
  breeder_silver:   'price_1TM09qQX4ubgjBMWuHVuAn3n',  // $20/mo
  breeder_gold:     'price_1TM0AUQX4ubgjBMWGjeViqsy',  // $40/mo
};

const ONE_TIME_PLANS = ['shopper_lifetime'];

// Create checkout session
router.post('/create-checkout', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;

  if (!PRICE_IDS[membership_type]) {
    return res.status(400).json({ error: 'Invalid membership type' });
  }

  const isOneTime = ONE_TIME_PLANS.includes(membership_type);
  const isBreeder = membership_type === 'breeder_silver' || membership_type === 'breeder_gold';

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: isOneTime ? 'payment' : 'subscription',
      line_items: [{ price: PRICE_IDS[membership_type], quantity: 1 }],
      // ✅ Breeders go to onboarding, others go to dashboard
      success_url: isBreeder
        ? 'https://pomsky-association.webflow.io/breeder-onboarding?payment=success'
        : 'https://pomsky-association.webflow.io/dashboard?payment=success',
      cancel_url: 'https://pomsky-association.webflow.io/memberships?payment=cancelled',
      customer_email: req.user.email,
      metadata: {
        user_id: req.user.id,
        membership_type
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get current subscription info
router.get('/subscription', authMiddleware, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, stripe_subscription_id, membership_type, membership_status')
    .eq('id', req.user.id)
    .single();

  if (!profile?.stripe_subscription_id) {
    return res.json({ subscription: null });
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(
      profile.stripe_subscription_id
    );
    res.json({ subscription });
  } catch {
    res.json({ subscription: null });
  }
});

// Cancel subscription
router.post('/cancel-subscription', authMiddleware, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id, account_type')
    .eq('id', req.user.id)
    .single();

  if (!profile?.stripe_subscription_id) {
    return res.status(400).json({ error: 'No active subscription found' });
  }

  try {
    // Cancel at period end so user keeps access till billing date
    await stripe.subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: true
    });

    await supabase
      .from('profiles')
      .update({ membership_status: 'cancelling' })
      .eq('id', req.user.id);

    res.json({ message: 'Subscription will cancel at end of billing period' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;