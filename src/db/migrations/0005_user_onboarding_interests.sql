-- Phase 7: UX & Community Activation — lightweight onboarding interests.

CREATE TABLE IF NOT EXISTS user_interests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, interest)
);

CREATE INDEX IF NOT EXISTS user_interests_interest_idx
  ON user_interests (interest);
