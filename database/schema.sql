CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE question_category AS ENUM (
  'AIR_LAW',
  'AIRCRAFT_GENERAL_KNOWLEDGE',
  'FLIGHT_PERFORMANCE_AND_PLANNING',
  'HUMAN_PERFORMANCE',
  'METEOROLOGY',
  'NAVIGATION',
  'OPERATIONAL_PROCEDURES',
  'PRINCIPLES_OF_FLIGHT',
  'COMMUNICATIONS',
  'GENERAL_SAFETY',
  'UNKNOWN'
);

CREATE TYPE progress_status AS ENUM ('UNREAD', 'CORRECT', 'INCORRECT');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  source_row_number integer,
  category question_category NOT NULL DEFAULT 'UNKNOWN',
  question_text text NOT NULL,
  correct_answer_key char(1) NOT NULL DEFAULT 'A' CHECK (correct_answer_key = 'A'),
  correct_answer text NOT NULL,
  distractors jsonb NOT NULL CHECK (jsonb_typeof(distractors) = 'array' AND jsonb_array_length(distractors) = 3),
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) = 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_progress (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status progress_status NOT NULL DEFAULT 'UNREAD',
  attempts_count integer NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  last_answered_at timestamptz,
  cached_client_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE support_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL DEFAULT 'BUG' CHECK (kind IN ('BUG', 'SUGGESTION', 'OTHER')),
  status varchar(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  context varchar(400),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Anonymous traffic tracking that powers the admin analytics panel. We store
-- only a client-generated visitor_id (a localStorage uuid) — never an IP or
-- other personal identifier — plus an optional user_id for logged-in visits.
CREATE TABLE page_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id varchar(64) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  path varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX questions_category_idx ON questions (category);
CREATE INDEX user_progress_user_status_idx ON user_progress (user_id, status);
CREATE INDEX user_progress_last_answered_idx ON user_progress (last_answered_at DESC);
CREATE INDEX support_reports_user_created_idx ON support_reports (user_id, created_at DESC);
CREATE INDEX support_reports_status_idx ON support_reports (status);
CREATE INDEX page_visits_created_idx ON page_visits (created_at);
CREATE INDEX page_visits_visitor_idx ON page_visits (visitor_id);
CREATE INDEX page_visits_user_idx ON page_visits (user_id);
