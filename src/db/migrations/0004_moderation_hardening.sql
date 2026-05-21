-- Tahap 5: moderation hardening, additive/low-risk schema changes.

ALTER TABLE content_reports
  ALTER COLUMN reporter_id DROP NOT NULL;

ALTER TABLE content_reports
  ADD COLUMN IF NOT EXISTS auto_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safety_matches text[];

CREATE INDEX IF NOT EXISTS content_reports_auto_detected_created_idx
  ON content_reports (auto_detected, created_at);

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

ALTER TABLE forum_replies
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text;
