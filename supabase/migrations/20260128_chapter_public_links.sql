-- =============================================================================
-- PUBLIC CHAPTER LINKS MIGRATION
-- =============================================================================
-- Feature: User-submitted public links for chapters
-- 
-- Goals:
-- 1. Auto-link official sources (Tier 1) and MangaDex (Tier 2) automatically
-- 2. Allow user-submitted links (Tier 3) with strict controls
-- 3. Max 3 visible links per chapter (race condition safe)
-- 4. Deduplicate identical URLs via SHA256 hash
-- 5. Reputation-weighted reporting system
-- 6. DMCA workflow support
-- 7. Append-only audit log for Safe Harbor compliance
-- =============================================================================

-- Create enums for link status and report reasons
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chapter_link_status') THEN
    CREATE TYPE chapter_link_status AS ENUM (
      'unverified',  -- User-submitted, pending moderation
      'visible',     -- Active and displayed
      'hidden',      -- Hidden by reports but not removed
      'removed'      -- Removed by admin/DMCA
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_report_reason') THEN
    CREATE TYPE link_report_reason AS ENUM (
      'broken',      -- Link is dead/404
      'malicious',   -- Malware/phishing
      'spam',        -- Spam/advertisement
      'copyright',   -- DMCA/copyright claim
      'other'        -- Other reason
    );
  END IF;
END $$;

-- =============================================================================
-- TABLE: chapter_links
-- =============================================================================
-- Main table for storing user-submitted and auto-linked chapter URLs
CREATE TABLE IF NOT EXISTS chapter_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Series and chapter identity
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  chapter_id UUID REFERENCES logical_chapters(id) ON DELETE SET NULL,
  chapter_number VARCHAR(100) NOT NULL,  -- Flexible: "1", "1.5", "Special"
  
  -- Source identification
  source_name TEXT NOT NULL,  -- Normalized: 'mangadex', 'mangapark', 'viz', etc.
  
  -- URL handling
  url TEXT NOT NULL,
  url_normalized TEXT NOT NULL,  -- Lowercase, trimmed, protocol-stripped for comparison
  url_hash CHAR(64) NOT NULL,    -- SHA256(url_normalized) for deduplication
  
  -- Status and scoring
  status chapter_link_status NOT NULL DEFAULT 'unverified',
  visibility_score INT NOT NULL DEFAULT 0,  -- upvotes - (weighted downvotes)
  
  -- Submission tracking
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Verification (for admin/system verification)
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  
  -- Reporting metrics
  last_report_score INT NOT NULL DEFAULT 0,  -- Weighted sum of active reports
  
  -- Soft delete
  deleted_at TIMESTAMPTZ,
  
  -- Metadata JSON for extensibility
  -- Schema: { displayName?: string, domain?: string, note?: string, scanlationGroup?: string }
  metadata JSONB DEFAULT '{}'::jsonb
);

-- =============================================================================
-- TABLE: chapter_link_reports
-- =============================================================================
-- User reports on chapter links
CREATE TABLE IF NOT EXISTS chapter_link_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_link_id UUID NOT NULL REFERENCES chapter_links(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason link_report_reason NOT NULL,
  details TEXT,  -- Optional description
  weight INT NOT NULL DEFAULT 1,  -- Computed from reporter trust_score at write time
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,  -- When/if report was resolved
  resolution_note TEXT,
  
  -- One report per user per link
  CONSTRAINT chapter_link_reports_unique_reporter UNIQUE (chapter_link_id, reporter_id)
);

-- =============================================================================
-- TABLE: link_votes
-- =============================================================================
-- User upvotes/downvotes on chapter links
CREATE TABLE IF NOT EXISTS link_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_link_id UUID NOT NULL REFERENCES chapter_links(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote INT NOT NULL CHECK (vote IN (1, -1)),  -- 1 = upvote, -1 = downvote
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- One vote per user per link
  CONSTRAINT link_votes_unique_user UNIQUE (chapter_link_id, user_id)
);

-- =============================================================================
-- TABLE: dmca_requests
-- =============================================================================
-- DMCA takedown requests for Safe Harbor compliance
CREATE TABLE IF NOT EXISTS dmca_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Claimant info
  requester_contact TEXT NOT NULL,  -- Email or contact info
  requester_name TEXT,
  requester_company TEXT,
  
  -- Target info
  target_url TEXT,  -- URL being claimed (may not match our link)
  target_link_id UUID REFERENCES chapter_links(id) ON DELETE SET NULL,
  target_series_id UUID REFERENCES series(id) ON DELETE SET NULL,
  
  -- Claim details
  work_title TEXT,  -- Title of copyrighted work
  claim_details TEXT,  -- Description of claim
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, processing, resolved, rejected
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: link_submission_audit (append-only)
-- =============================================================================
-- Immutable audit trail for all link operations (Safe Harbor compliance)
-- RULE: INSERT ONLY - never update or delete records
CREATE TABLE IF NOT EXISTS link_submission_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_link_id UUID,  -- May be null if link was rejected before creation
  action VARCHAR(50) NOT NULL,  -- submit, approve, reject, report, remove, restore, vote
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_ip INET,  -- IP address for abuse tracking
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Action-specific data
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent updates and deletes on audit table
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS link_submission_audit_immutable ON link_submission_audit;
CREATE TRIGGER link_submission_audit_immutable
BEFORE UPDATE OR DELETE ON link_submission_audit
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();

-- =============================================================================
-- TABLE: domain_blacklist
-- =============================================================================
-- Blocked domains (malware, phishing, DMCA repeat offenders)
CREATE TABLE IF NOT EXISTS domain_blacklist (
  domain VARCHAR(255) PRIMARY KEY,
  reason VARCHAR(100) NOT NULL,  -- malware, phishing, dmca_repeat, spam
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,  -- Optional expiration for temporary blocks
  notes TEXT
);

-- =============================================================================
-- INDEXES: chapter_links
-- =============================================================================

-- Primary lookup: Get links for a specific chapter
-- Uses COALESCE to handle both chapter_id and chapter_number lookups
CREATE INDEX IF NOT EXISTS idx_chapter_links_series_chapter_status 
ON chapter_links (
  series_id, 
  COALESCE(chapter_id::text, chapter_number), 
  status
)
WHERE deleted_at IS NULL;

-- Deduplication index: Prevent same URL for same chapter
-- Uses COALESCE for flexible chapter identification
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_links_dedupe
ON chapter_links (
  series_id, 
  COALESCE(chapter_id::text, chapter_number), 
  url_hash
)
WHERE deleted_at IS NULL;

-- URL hash lookup (for checking duplicates across chapters)
CREATE INDEX IF NOT EXISTS idx_chapter_links_urlhash
ON chapter_links (url_hash);

-- Source name lookup (for aggregated source stats)
CREATE INDEX IF NOT EXISTS idx_chapter_links_source
ON chapter_links (source_name);

-- Submitted by user (for user's submission history)
CREATE INDEX IF NOT EXISTS idx_chapter_links_submitted_by
ON chapter_links (submitted_by, submitted_at DESC)
WHERE submitted_by IS NOT NULL;

-- Pending moderation queue
CREATE INDEX IF NOT EXISTS idx_chapter_links_pending
ON chapter_links (submitted_at ASC)
WHERE status = 'unverified' AND deleted_at IS NULL;

-- Visibility score ranking (for sorting links by popularity)
CREATE INDEX IF NOT EXISTS idx_chapter_links_visibility
ON chapter_links (series_id, chapter_id, visibility_score DESC)
WHERE status = 'visible' AND deleted_at IS NULL;

-- =============================================================================
-- INDEXES: chapter_link_reports
-- =============================================================================

-- Reports by link (for calculating weighted report score)
CREATE INDEX IF NOT EXISTS idx_chapter_link_reports_link
ON chapter_link_reports (chapter_link_id, created_at DESC);

-- Reporter history (for detecting abuse patterns)
CREATE INDEX IF NOT EXISTS idx_chapter_link_reports_reporter
ON chapter_link_reports (reporter_id, created_at DESC);

-- Unresolved reports queue
CREATE INDEX IF NOT EXISTS idx_chapter_link_reports_unresolved
ON chapter_link_reports (created_at ASC)
WHERE resolved_at IS NULL;

-- =============================================================================
-- INDEXES: link_votes
-- =============================================================================

-- Votes by link (for counting)
CREATE INDEX IF NOT EXISTS idx_link_votes_link
ON link_votes (chapter_link_id);

-- User's voting history
CREATE INDEX IF NOT EXISTS idx_link_votes_user
ON link_votes (user_id, created_at DESC);

-- =============================================================================
-- INDEXES: dmca_requests
-- =============================================================================

-- Pending DMCA queue
CREATE INDEX IF NOT EXISTS idx_dmca_requests_pending
ON dmca_requests (created_at ASC)
WHERE status = 'pending';

-- By target link
CREATE INDEX IF NOT EXISTS idx_dmca_requests_link
ON dmca_requests (target_link_id)
WHERE target_link_id IS NOT NULL;

-- =============================================================================
-- INDEXES: link_submission_audit
-- =============================================================================

-- By link (for viewing action history)
CREATE INDEX IF NOT EXISTS idx_link_submission_audit_link
ON link_submission_audit (chapter_link_id, created_at DESC)
WHERE chapter_link_id IS NOT NULL;

-- By actor (for detecting abuse patterns)
CREATE INDEX IF NOT EXISTS idx_link_submission_audit_actor
ON link_submission_audit (actor_id, created_at DESC)
WHERE actor_id IS NOT NULL;

-- By action type (for analytics)
CREATE INDEX IF NOT EXISTS idx_link_submission_audit_action
ON link_submission_audit (action, created_at DESC);

-- =============================================================================
-- FUNCTION: Update visibility_score on vote changes
-- =============================================================================
CREATE OR REPLACE FUNCTION update_link_visibility_score()
RETURNS TRIGGER AS $$
DECLARE
  new_score INT;
BEGIN
  -- Calculate new visibility score from all votes
  SELECT COALESCE(SUM(vote), 0)
  INTO new_score
  FROM link_votes
  WHERE chapter_link_id = COALESCE(NEW.chapter_link_id, OLD.chapter_link_id);
  
  -- Update the chapter_link
  UPDATE chapter_links
  SET visibility_score = new_score
  WHERE id = COALESCE(NEW.chapter_link_id, OLD.chapter_link_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_visibility_score_trigger ON link_votes;
CREATE TRIGGER update_visibility_score_trigger
AFTER INSERT OR UPDATE OR DELETE ON link_votes
FOR EACH ROW
EXECUTE FUNCTION update_link_visibility_score();

-- =============================================================================
-- FUNCTION: Update last_report_score on report changes
-- =============================================================================
CREATE OR REPLACE FUNCTION update_link_report_score()
RETURNS TRIGGER AS $$
DECLARE
  new_score INT;
BEGIN
  -- Calculate weighted report score (only unresolved reports)
  SELECT COALESCE(SUM(weight), 0)
  INTO new_score
  FROM chapter_link_reports
  WHERE chapter_link_id = COALESCE(NEW.chapter_link_id, OLD.chapter_link_id)
    AND resolved_at IS NULL;
  
  -- Update the chapter_link
  UPDATE chapter_links
  SET last_report_score = new_score
  WHERE id = COALESCE(NEW.chapter_link_id, OLD.chapter_link_id);
  
  -- Auto-hide if report score exceeds threshold (3.0 weighted)
  IF new_score >= 3 THEN
    UPDATE chapter_links
    SET status = 'hidden'
    WHERE id = COALESCE(NEW.chapter_link_id, OLD.chapter_link_id)
      AND status = 'visible';
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_report_score_trigger ON chapter_link_reports;
CREATE TRIGGER update_report_score_trigger
AFTER INSERT OR UPDATE OR DELETE ON chapter_link_reports
FOR EACH ROW
EXECUTE FUNCTION update_link_report_score();

-- =============================================================================
-- FUNCTION: Enforce max 3 visible links per chapter
-- =============================================================================
-- This function is called before inserting/updating a link to visible status
-- It uses advisory locks to prevent race conditions
CREATE OR REPLACE FUNCTION check_visible_link_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count INT;
  chapter_key TEXT;
  lock_id BIGINT;
BEGIN
  -- Only check when setting status to 'visible'
  IF NEW.status != 'visible' THEN
    RETURN NEW;
  END IF;
  
  -- Skip if already was visible (update to same status)
  IF TG_OP = 'UPDATE' AND OLD.status = 'visible' THEN
    RETURN NEW;
  END IF;
  
  -- Create a deterministic lock key from series_id and chapter identifier
  chapter_key := NEW.series_id::text || ':' || COALESCE(NEW.chapter_id::text, NEW.chapter_number);
  lock_id := ('x' || substr(md5(chapter_key), 1, 15))::bit(60)::bigint;
  
  -- Acquire advisory lock for this chapter
  PERFORM pg_advisory_xact_lock(lock_id);
  
  -- Count current visible links for this chapter
  SELECT COUNT(*)
  INTO current_count
  FROM chapter_links
  WHERE series_id = NEW.series_id
    AND COALESCE(chapter_id::text, chapter_number) = COALESCE(NEW.chapter_id::text, NEW.chapter_number)
    AND status = 'visible'
    AND deleted_at IS NULL
    AND id != NEW.id;  -- Exclude self for updates
  
  IF current_count >= 3 THEN
    RAISE EXCEPTION 'Maximum 3 visible links allowed per chapter. Current count: %', current_count;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_visible_link_limit_trigger ON chapter_links;
CREATE TRIGGER check_visible_link_limit_trigger
BEFORE INSERT OR UPDATE ON chapter_links
FOR EACH ROW
EXECUTE FUNCTION check_visible_link_limit();

-- =============================================================================
-- COMMENTS: Documentation for tables and columns
-- =============================================================================
COMMENT ON TABLE chapter_links IS 'User-submitted and auto-linked chapter URLs. Max 3 visible per chapter.';
COMMENT ON COLUMN chapter_links.url_normalized IS 'Lowercase, trimmed URL without protocol for comparison';
COMMENT ON COLUMN chapter_links.url_hash IS 'SHA256 hash of url_normalized for deduplication';
COMMENT ON COLUMN chapter_links.visibility_score IS 'Net score from upvotes/downvotes (positive = good)';
COMMENT ON COLUMN chapter_links.last_report_score IS 'Weighted sum of active reports (higher = more reported)';

COMMENT ON TABLE chapter_link_reports IS 'User reports on chapter links with reputation-weighted scoring';
COMMENT ON COLUMN chapter_link_reports.weight IS 'Report weight based on reporter trust_score at time of report';

COMMENT ON TABLE link_votes IS 'User upvotes (+1) and downvotes (-1) on chapter links';

COMMENT ON TABLE dmca_requests IS 'DMCA takedown requests for Safe Harbor compliance';

COMMENT ON TABLE link_submission_audit IS 'Immutable audit trail for all link operations (Safe Harbor)';

COMMENT ON TABLE domain_blacklist IS 'Blocked domains: malware, phishing, DMCA repeat offenders';

COMMENT ON FUNCTION check_visible_link_limit() IS 'Enforces max 3 visible links per chapter using advisory locks';
COMMENT ON FUNCTION update_link_visibility_score() IS 'Automatically updates visibility_score on vote changes';
COMMENT ON FUNCTION update_link_report_score() IS 'Auto-updates report score and hides links exceeding threshold';

-- =============================================================================
-- RLS POLICIES (Row Level Security)
-- =============================================================================
-- Enable RLS on all tables
ALTER TABLE chapter_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_link_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmca_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_submission_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_blacklist ENABLE ROW LEVEL SECURITY;

-- chapter_links: Public read for visible, user can manage own submissions
CREATE POLICY chapter_links_read ON chapter_links
FOR SELECT USING (
  status = 'visible' AND deleted_at IS NULL
  OR submitted_by = auth.uid()
);

CREATE POLICY chapter_links_insert ON chapter_links
FOR INSERT WITH CHECK (
  submitted_by = auth.uid()
);

CREATE POLICY chapter_links_update ON chapter_links
FOR UPDATE USING (
  submitted_by = auth.uid()
);

-- chapter_link_reports: User can read/create own reports
CREATE POLICY chapter_link_reports_read ON chapter_link_reports
FOR SELECT USING (reporter_id = auth.uid());

CREATE POLICY chapter_link_reports_insert ON chapter_link_reports
FOR INSERT WITH CHECK (reporter_id = auth.uid());

-- link_votes: User can manage own votes
CREATE POLICY link_votes_all ON link_votes
FOR ALL USING (user_id = auth.uid());

-- dmca_requests: Insert only (admins handle via service role)
CREATE POLICY dmca_requests_insert ON dmca_requests
FOR INSERT WITH CHECK (true);

-- link_submission_audit: Insert only (read via service role)
CREATE POLICY link_submission_audit_insert ON link_submission_audit
FOR INSERT WITH CHECK (true);

-- domain_blacklist: Public read (manage via service role)
CREATE POLICY domain_blacklist_read ON domain_blacklist
FOR SELECT USING (true);
