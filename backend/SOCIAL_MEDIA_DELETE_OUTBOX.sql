-- Private storage deletion queue. Do not deploy an upload route from this migration.
-- Media revocation and enqueue must occur in the same transaction.
CREATE TABLE IF NOT EXISTS social_media_delete_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE CHECK (
    object_key ~ '^social/processed/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[.](jpg|png|webp|mp4)$'
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_media_delete_pending_idx
  ON social_media_delete_outbox (next_attempt_at, id)
  WHERE completed_at IS NULL;
