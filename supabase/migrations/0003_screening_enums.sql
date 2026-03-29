-- Screening workflow ENUMs
-- These types support the article screening phase of systematic reviews.

CREATE TYPE screening_phase AS ENUM ('title_abstract', 'full_text');
CREATE TYPE screening_decision AS ENUM ('include', 'exclude', 'maybe');
CREATE TYPE screening_conflict_status AS ENUM ('none', 'conflict', 'resolved');
