const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

router.get('/dashboard', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const [profileResult, ordersResult, billingResult,
         shippingResult, paymentResult, historyResult] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('billing_addresses').select('*').eq('user_id', userId),
      supabase.from('shipping_addresses').select('*').eq('user_id', userId),
      supabase.from('payment_methods').select('*').eq('user_id', userId),
      supabase.from('membership_history').select('*').eq('user_id', userId).order('started_at', { ascending: false })
    ]);

  const profile = profileResult.data;

  res.json({
    name: profile?.full_name || req.user.email,
    email: profile?.email || req.user.email,
    account_type: profile?.account_type || 'shopper',
    membership_type: profile?.membership_type || 'shopper_free',
    membership_status: profile?.membership_status || 'active',
    stripe_subscription_id: profile?.stripe_subscription_id || null,
    created_at: profile?.created_at || new Date().toISOString(),
    orders: ordersResult.data || [],
    billing_addresses: billingResult.data || [],
    shipping_addresses: shippingResult.data || [],
    payment_methods: paymentResult.data || [],
    membership_history: historyResult.data || []
  });
});

module.exports = router;