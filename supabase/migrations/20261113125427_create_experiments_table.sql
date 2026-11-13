/*
# Create experiments table for RegexLab (single-tenant, no auth)

1. Plain-English summary
RegexLab lets users build regular expressions, inspect their automata and run
test strings. Users can save their work as "experiments" so they can come back
later. This migration creates the table that stores those saved experiments.

2. New Tables
- `experiments`
  - `id` (uuid, primary key, auto-generated)
  - `name` (text, not null) — display name chosen by the user
  - `pattern` (text, not null) — the regular expression pattern
  - `test_strings` (jsonb, not null) — array of test strings for this experiment
  - `custom_automaton` (jsonb, nullable) — a hand-designed automaton (states,
    transitions, initial/accepting flags) built in the designer tool, if any
  - `created_at` (timestamp) — when the experiment was first saved
  - `updated_at` (timestamp) — when it was last saved

3. Security
- Enable RLS on `experiments`.
- Grant SELECT, INSERT, UPDATE, DELETE to `anon` + `authenticated`: RegexLab
  has no sign-in, so every visitor shares this single workspace by design.
- Four separate per-verb policies, all scoped `TO anon, authenticated` with
  `USING (true)` / `WITH CHECK (true)` because the data is intentionally
  public/shared (single-tenant tool, no user accounts).

4. Notes
- No `user_id` column: the app does not have accounts.
- Index on `updated_at` so the experiments list can be sorted newest-first.
*/

CREATE TABLE IF NOT EXISTS experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pattern text NOT NULL DEFAULT '',
  test_strings jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_automaton jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experiments_updated_at_idx ON experiments (updated_at DESC);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON experiments TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_experiments" ON experiments;
CREATE POLICY "anon_select_experiments" ON experiments
FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_experiments" ON experiments;
CREATE POLICY "anon_insert_experiments" ON experiments
FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_experiments" ON experiments;
CREATE POLICY "anon_update_experiments" ON experiments
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_experiments" ON experiments;
CREATE POLICY "anon_delete_experiments" ON experiments
FOR DELETE TO anon, authenticated USING (true);
