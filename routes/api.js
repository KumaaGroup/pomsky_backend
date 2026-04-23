const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

router.get('/dashboard', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const [profileResult, ordersResult, billingResult,
         shippingResult, paymentResult, historyResult, breederResult] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('billing_addresses').select('*').eq('user_id', userId),
      supabase.from('shipping_addresses').select('*').eq('user_id', userId),
      supabase.from('payment_methods').select('*').eq('user_id', userId),
      supabase.from('membership_history').select('*').eq('user_id', userId).order('started_at', { ascending: false }),
      supabase.from('breeder_profiles').select('id').eq('user_id', userId).maybeSingle()
    ]);

  const profile = profileResult.data;

  res.json({
    name: profile?.full_name || req.user.email,
    email: profile?.email || req.user.email,
    // Multi-role fields
    membership_shopper: profile?.membership_shopper || 'shopper_free',
    membership_breeder: profile?.membership_breeder || 'breeder_free',
    membership_owner: profile?.membership_owner || 'owner_free',
    status_shopper: profile?.status_shopper || 'active',
    status_breeder: profile?.status_breeder || 'active',
    status_owner: profile?.status_owner || 'active',
    // Legacy fields for compatibility
    account_type: profile?.account_type || 'shopper',
    membership_type: profile?.membership_type || 'shopper_free',
    membership_status: profile?.membership_status || 'active',
    stripe_subscription_id: profile?.stripe_subscription_id || null,
    created_at: profile?.created_at || new Date().toISOString(),
    orders: ordersResult.data || [],
    billing_addresses: billingResult.data || [],
    shipping_addresses: shippingResult.data || [],
    payment_methods: paymentResult.data || [],
    membership_history: historyResult.data || [],
    breeder_id: breederResult.data?.id || null
  });
});

module.exports = router;