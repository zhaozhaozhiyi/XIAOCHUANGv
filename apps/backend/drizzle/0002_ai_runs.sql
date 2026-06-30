CREATE TABLE IF NOT EXISTS ai_runs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  skill_id VARCHAR(100) NOT NULL,
  mode VARCHAR(100) NOT NULL,
  scene VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  user_message TEXT,
  assistant_message TEXT,
  references_json TEXT,
  actions_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_target ON ai_runs(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_runs_user_created_at ON ai_runs(user_id, created_at);
