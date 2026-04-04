const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

// Stripe Price IDs from your Stripe dashboard
const PRICE_IDS = {
  shopper_monthly:  'price_xxxxx',  // $2.99/mo
  shopper_lifetime: 'price_xxxxx',  // $14.99 one-time
  owner_monthly:    'price_xxxxx',  // $20/mo
  owner_annual:     'price_xxxxx',  // $200/yr
  breeder_silver:   'price_xxxxx',  // $20/mo
  breeder_gold:     'price_xxxxx',  // $40/mo
};

// Create Stripe checkout session
router.post('/create-checkout', authMiddleware, async (req, res) => {
  const { membership_type } = req.body;

  if (!PRICE_IDS[membership_type]) {
    return res.status(400).json({ error: 'Invalid membership type' });
  }

  const isOneTime = membership_type === 'shopper_lifetime';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: isOneTime ? 'payment' : 'subscription',
    line_items: [{
      price: PRICE_IDS[membership_type],
      quantity: 1
    }],
    success_url: 'https://pomsky-association.webflow.io/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://pomsky-association.webflow.io/pricing',
    metadata: {
      user_id: req.user.id,
      membership_type: membership_type
    }
  });

  res.json({ url: session.url });
});

module.exports = router;