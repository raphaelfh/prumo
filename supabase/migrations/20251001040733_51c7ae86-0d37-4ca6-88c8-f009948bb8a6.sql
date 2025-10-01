-- Add allowed_levels column to assessment_items table
-- This allows each item to have its own set of allowed levels
-- If null, it will fall back to the instrument's allowed_levels
ALTER TABLE assessment_items 
ADD COLUMN IF NOT EXISTS allowed_levels jsonb;

-- Optionally, copy the instrument's allowed_levels to items that don't have them
-- This is a one-time data migration
UPDATE assessment_items ai
SET allowed_levels = inst.allowed_levels
FROM assessment_instruments inst
WHERE ai.instrument_id = inst.id 
AND ai.allowed_levels IS NULL;

COMMENT ON COLUMN assessment_items.allowed_levels IS 'Allowed response levels for this specific item. Falls back to instrument allowed_levels if null.';