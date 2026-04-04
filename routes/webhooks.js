const express = require('express');
const router = express.Router();
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY environment variable');
}
const stripe = require('stripe')(stripeSecretKey);
const supabase = require('../supabase');

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Payment successful → upgrade membership
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { user_id, membership_type } = session.metadata;

    await supabase
      .from('profiles')
      .update({
        membership_type: membership_type,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription || null
      })
      .eq('id', user_id);
  }

  // Subscription cancelled → downgrade to free
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_type')
      .eq('stripe_customer_id', subscription.customer)
      .single();

    const freeTier = {
      shopper: 'shopper_free',
      owner: 'owner_free',
      breeder: 'breeder_free'
    };

    await supabase
      .from('profiles')
      .update({ membership_type: freeTier[profile.account_type] })
      .eq('stripe_customer_id', subscription.customer);
  }

  res.json({ received: true });
});

module.exports = router;