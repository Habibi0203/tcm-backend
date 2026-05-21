-- Phase 4: moderation report queue for forum content.
CREATE TABLE IF NOT EXISTS content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type varchar(20) NOT NULL CHECK (target_type IN ('thread', 'reply')),
  target_id uuid NOT NULL,
  reason varchar(60) NOT NULL CHECK (reason IN ('medical_claim', 'spam', 'fraud', 'harassment', 'illegal_product', 'privacy', 'other')),
  details text,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_reporter_target_unique UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS content_reports_status_created_idx ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_target_idx ON content_reports (target_type, target_id);
