const supabase = require('../supabase');

module.exports = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Fetch user profile to check membership tiers
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('membership_type, membership_breeder, account_type')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('Approved Breeder Middleware Database Error:', profileError);
      return res.status(500).json({ error: 'Database query failed' });
    }

    const membership = profile?.membership_breeder || profile?.membership_type || 'shopper_free';
    const isBreeder = membership.startsWith('breeder_');

    if (!isBreeder) {
      return res.status(403).json({ error: 'Access denied. Only breeders can access this endpoint.' });
    }

    // 2. ONLY apply onboarding and admin approval checks to the Free Breeder tier
    if (membership === 'breeder_free') {
      const { data: breeder, error: breederError } = await supabase
        .from('breeder_profiles')
        .select('is_onboarded, is_approved')
        .eq('user_id', userId)
        .maybeSingle();

      if (breederError) {
        console.error('Approved Breeder Middleware Breeder Fetch Error:', breederError);
        return res.status(500).json({ error: 'Database query failed' });
      }

      if (!breeder || !breeder.is_onboarded) {
        return res.status(403).json({
          error: 'Please complete your breeder onboarding form first.',
          code: 'BREEDER_NEEDS_ONBOARDING',
          is_onboarded: false,
          is_approved: false
        });
      }

      if (!breeder.is_approved) {
        return res.status(403).json({
          error: 'Your breeder profile is pending admin approval.',
          code: 'BREEDER_PENDING_APPROVAL',
          is_onboarded: true,
          is_approved: false
        });
      }

      req.breeder = breeder; // attach breeder profile for potential down-route use
    }

    // 3. Paid plan breeders (Silver/Gold) or fully approved free breeders proceed as usual
    next();
  } catch (err) {
    console.error('Approved Breeder Middleware Crash:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
