-- Run this in the Supabase SQL Editor to fix any existing listings that are missing the user_id
-- This will copy the user_id from the corresponding breeder_profile

UPDATE pomsky_listings pl
SET user_id = bp.user_id
FROM breeder_profiles bp
WHERE pl.breeder_id = bp.id AND pl.user_id IS NULL;
