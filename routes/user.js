const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');

// Update account details
router.post('/update-account', authMiddleware, async (req, res) => {
  const { full_name, email } = req.body;
  const userId = req.user.id;

  const { error } = await supabase
    .from('profiles')
    .update({ full_name, email })
    .eq('id', userId);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Account updated successfully!' });
});

// Change password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { new_password } = req.body;

  const { error } = await supabase.auth.admin.updateUserById(
    req.user.id,
    { password: new_password }
  );

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Password changed successfully!' });
});

// Add billing address
router.post('/billing-address', authMiddleware, async (req, res) => {
  const { first_name, last_name, address_line1, address_line2, city, state, zip_code, country } = req.body;

  // Set all existing to non-default
  await supabase
    .from('billing_addresses')
    .update({ is_default: false })
    .eq('user_id', req.user.id);

  const { data, error } = await supabase
    .from('billing_addresses')
    .insert({
      user_id: req.user.id,
      first_name, last_name, address_line1, address_line2,
      city, state, zip_code, country: country || 'US',
      is_default: true
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Billing address saved!', address: data });
});

// Add shipping address
router.post('/shipping-address', authMiddleware, async (req, res) => {
  const { first_name, last_name, address_line1, address_line2, city, state, zip_code, country } = req.body;

  await supabase
    .from('shipping_addresses')
    .update({ is_default: false })
    .eq('user_id', req.user.id);

  const { data, error } = await supabase
    .from('shipping_addresses')
    .insert({
      user_id: req.user.id,
      first_name, last_name, address_line1, address_line2,
      city, state, zip_code, country: country || 'US',
      is_default: true
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Shipping address saved!', address: data });
});

// Delete billing address
router.delete('/billing-address/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('billing_addresses')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Address deleted!' });
});

// Delete shipping address
router.delete('/shipping-address/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('shipping_addresses')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Address deleted!' });
});

module.exports = router;