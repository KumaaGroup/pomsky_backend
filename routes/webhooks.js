const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../supabase');

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    console.log('Webhook received:', event.type);

    try {
      switch (event.type) {

        // ── Payment successful ──
        case 'checkout.session.completed': {
  const session = event.data.object;
  const { user_id, membership_type } = session.metadata;

  // 🔥 ADD THIS
  const isPaidBreeder =
    membership_type === 'breeder_silver' ||
    membership_type === 'breeder_gold';

  const { data: existingBreeder } = await supabase
    .from('breeder_profiles')
    .select('id')
    .eq('id', user_id)
    .single();

  const needsOnboarding = isPaidBreeder && !existingBreeder;

  // Get current membership before upgrading
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('membership_type, membership_status, stripe_subscription_id')
    .eq('id', user_id)
    .single();

  if (currentProfile?.membership_type) {
    await supabase
      .from('membership_history')
      .insert({
        user_id,
        membership_type: currentProfile.membership_type,
        membership_status: 'replaced',
        ended_at: new Date().toISOString(),
        stripe_subscription_id: currentProfile.stripe_subscription_id
      });
  }

  await supabase
    .from('membership_history')
    .insert({
      user_id,
      membership_type,
      membership_status: 'active',
      started_at: new Date().toISOString(),
      stripe_subscription_id: session.subscription || null
    });

  await supabase
    .from('profiles')
    .update({
      membership_type,
      membership_status: 'active',
      account_type: isPaidBreeder ? 'breeder' : currentProfile.account_type,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription || null,
      needs_onboarding: needsOnboarding // ✅ FIXED
    })
    .eq('id', user_id);

  break;
}

        // ── Subscription renewed ──
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object;

          await supabase
            .from('profiles')
            .update({ membership_status: 'active' })
            .eq('stripe_customer_id', invoice.customer);

          console.log('Subscription renewed for customer:', invoice.customer);
          break;
        }

        // ── Payment failed ──
        case 'invoice.payment_failed': {
          const invoice = event.data.object;

          await supabase
            .from('profiles')
            .update({ membership_status: 'past_due' })
            .eq('stripe_customer_id', invoice.customer);

          console.log('Payment failed for customer:', invoice.customer);
          break;
        }

        // ── Subscription cancelled ──
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;

          const { data: profile } = await supabase
            .from('profiles')
            .select('account_type')
            .eq('stripe_customer_id', subscription.customer)
            .single();

          const freeTiers = {
            shopper: 'shopper_free',
            owner:   'owner_free',
            breeder: 'breeder_free'
          };

          const freeTier = freeTiers[profile?.account_type] || 'shopper_free';

          await supabase
            .from('profiles')
            .update({
              membership_type: freeTier,
              membership_status: 'cancelled',
              stripe_subscription_id: null
            })
            .eq('stripe_customer_id', subscription.customer);

          console.log('Subscription cancelled, downgraded to:', freeTier);
          break;
        }

        // ── Subscription cancelling at period end ──
        case 'customer.subscription.updated': {
          const subscription = event.data.object;

          if (subscription.cancel_at_period_end) {
            await supabase
              .from('profiles')
              .update({ membership_status: 'cancelling' })
              .eq('stripe_customer_id', subscription.customer);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Webhook processing error:', err);
    }

    res.json({ received: true });
  }
);

module.exports = router;