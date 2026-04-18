-- Run this in your Supabase SQL Editor
-- Adds missing columns to breeder_requests so it can capture full profile data.
-- profile_image and social links are text[] to match breeder_profiles schema exactly,
-- so data flows cleanly from request → profile on admin approval with no type conversion.

ALTER TABLE public.breeder_requests
  ADD COLUMN IF NOT EXISTS country           TEXT DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS email             TEXT,
  ADD COLUMN IF NOT EXISTS profile_image     TEXT[],   -- array of Supabase Storage URLs
  ADD COLUMN IF NOT EXISTS social_facebook   TEXT[],   -- matches breeder_profiles.social_facebook
  ADD COLUMN IF NOT EXISTS social_instagram  TEXT[],   -- matches breeder_profiles.social_instagram
  ADD COLUMN IF NOT EXISTS social_twitter    TEXT[];   -- matches breeder_profiles.social_twitter
