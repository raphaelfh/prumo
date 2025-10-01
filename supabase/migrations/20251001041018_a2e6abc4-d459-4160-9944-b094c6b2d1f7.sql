-- Ensure all items have allowed_levels before dropping the column from instruments
-- Copy instrument's allowed_levels to any items that don't have them yet
UPDATE assessment_items ai
SET allowed_levels = inst.allowed_levels
FROM assessment_instruments inst
WHERE ai.instrument_id = inst.id 
AND ai.allowed_levels IS NULL;

-- Make allowed_levels NOT NULL in assessment_items since it's now required
ALTER TABLE assessment_items 
ALTER COLUMN allowed_levels SET NOT NULL;

-- Drop the allowed_levels column from assessment_instruments
ALTER TABLE assessment_instruments 
DROP COLUMN IF EXISTS allowed_levels;

COMMENT ON COLUMN assessment_items.allowed_levels IS 'Allowed response levels for this item (required)';