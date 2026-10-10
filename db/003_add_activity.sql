CREATE TABLE IF NOT EXISTS item_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  item_id UUID,
  action TEXT NOT NULL CHECK (action IN ('added', 'modified', 'deleted')),
  item_name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_activity_user_created_idx ON item_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS item_activity_user_item_name_idx ON item_activity(user_id, item_name);
