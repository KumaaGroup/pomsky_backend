const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../supabase');
const { triggerMembershipTagById } = require('../utils/activecampaign');

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

          const isBreeder = membership_type === 'breeder_silver' || membership_type === 'breeder_gold';
          const isOwner   = membership_type === 'owner_monthly' || membership_type === 'owner_annual';
          const isShopper = membership_type === 'shopper_monthly' || membership_type === 'shopper_lifetime';

          let category = 'shopper';
          if (isBreeder) category = 'breeder';
          if (isOwner)   category = 'owner';

          const { data: existingBreeder } = await supabase
            .from('breeder_profiles')
            .select('id')
            .eq('user_id', user_id)
            .single();

          const needsOnboarding = isBreeder && !existingBreeder;

          // Update the category-specific fields
          const updateData = {
            [`membership_${category}`]: membership_type,
            [`status_${category}`]: 'active',
            [`sub_id_${category}`]: session.subscription || null,
            stripe_customer_id: session.customer,
            // Keep legacy fields for backward compatibility during transition
            membership_type,
            membership_status: 'active',
            stripe_subscription_id: session.subscription || null,
            needs_onboarding: needsOnboarding
          };

          await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', user_id);

          // Trigger ActiveCampaign tagging for the paid membership
          try {
            await triggerMembershipTagById(user_id, membership_type);
          } catch (acErr) {
            console.error('ActiveCampaign Stripe webhook tagging error:', acErr.message);
          }

          // Log to history
          await supabase
            .from('membership_history')
            .insert({
              user_id,
              membership_type,
              membership_status: 'active',
              started_at: new Date().toISOString(),
              stripe_subscription_id: session.subscription || null
            });

          // Handle Breeder Profile
          if (isBreeder) {
            if (existingBreeder) {
              await supabase
                .from('breeder_profiles')
                .update({ is_featured: membership_type === 'breeder_gold' })
                .eq('user_id', user_id);
            } else {
              await supabase
                .from('breeder_profiles')
                .insert({
                  user_id: user_id,
                  breeder_name: 'New Breeder',
                  business_name: 'Pending Setup',
                  is_featured: membership_type === 'breeder_gold',
                  is_approved: false
                });
            }
          }

          break;
        }

        // ── Subscription renewed ──
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object;
          const subId = invoice.subscription;

          // Find which category this subscription belongs to
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, sub_id_shopper, sub_id_breeder, sub_id_owner')
            .eq('stripe_customer_id', invoice.customer)
            .single();

          if (profile) {
            let field = 'membership_status'; // default
            if (profile.sub_id_shopper === subId) field = 'status_shopper';
            if (profile.sub_id_breeder === subId) field = 'status_breeder';
            if (profile.sub_id_owner === subId)   field = 'status_owner';

            await supabase
              .from('profiles')
              .update({ [field]: 'active', membership_status: 'active' })
              .eq('id', profile.id);
          }
          break;
        }

        // ── Payment failed ──
        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          const subId = invoice.subscription;

          const { data: profile } = await supabase
            .from('profiles')
            .select('id, sub_id_shopper, sub_id_breeder, sub_id_owner')
            .eq('stripe_customer_id', invoice.customer)
            .single();

          if (profile) {
            let field = 'membership_status';
            if (profile.sub_id_shopper === subId) field = 'status_shopper';
            if (profile.sub_id_breeder === subId) field = 'status_breeder';
            if (profile.sub_id_owner === subId)   field = 'status_owner';

            await supabase
              .from('profiles')
              .update({ [field]: 'past_due', membership_status: 'past_due' })
              .eq('id', profile.id);
          }
          break;
        }

        // ── Subscription cancelled ──
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const subId = subscription.id;

          const { data: profile } = await supabase
            .from('profiles')
            .select('id, sub_id_shopper, sub_id_breeder, sub_id_owner, membership_type')
            .eq('stripe_customer_id', subscription.customer)
            .single();

          if (profile) {
            let category = 'shopper';
            if (profile.sub_id_shopper === subId) category = 'shopper';
            if (profile.sub_id_breeder === subId) category = 'breeder';
            if (profile.sub_id_owner === subId)   category = 'owner';

            const freeTier = `${category}_free`;

            await supabase
              .from('profiles')
              .update({
                [`membership_${category}`]: freeTier,
                [`status_${category}`]: 'cancelled',
                [`sub_id_${category}`]: null,
                // Legacy fields
                membership_type: freeTier,
                membership_status: 'cancelled'
              })
              .eq('id', profile.id);

            if (category === 'breeder' && profile.membership_type === 'breeder_gold') {
              await supabase
                .from('breeder_profiles')
                .update({ is_featured: false })
                .eq('user_id', profile.id);
            }
          }
          break;
        }

        // ── Subscription cancelling at period end ──
        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          if (subscription.cancel_at_period_end) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('id, sub_id_shopper, sub_id_breeder, sub_id_owner')
              .eq('stripe_customer_id', subscription.customer)
              .single();

            if (profile) {
              let field = 'membership_status';
              if (profile.sub_id_shopper === subscription.id) field = 'status_shopper';
              if (profile.sub_id_breeder === subscription.id) field = 'status_breeder';
              if (profile.sub_id_owner === subscription.id)   field = 'status_owner';

              await supabase
                .from('profiles')
                .update({ [field]: 'cancelling', membership_status: 'cancelling' })
                .eq('id', profile.id);
            }
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