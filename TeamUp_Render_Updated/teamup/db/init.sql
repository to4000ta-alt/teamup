-- Teamup database schema. This file is applied when the PostgreSQL volume is first created.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  major TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60)
);

CREATE TABLE IF NOT EXISTS user_skills (
  user_id INT REFERENCES users ON DELETE CASCADE,
  skill_id INT REFERENCES skills ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  course TEXT DEFAULT '',
  description TEXT DEFAULT '',
  team_size SMALLINT NOT NULL DEFAULT 4 CHECK (team_size BETWEEN 2 AND 12),
  deadline DATE,
  image_key TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','full','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_skills (
  project_id INT REFERENCES projects ON DELETE CASCADE,
  skill_id INT REFERENCES skills ON DELETE CASCADE,
  PRIMARY KEY (project_id, skill_id)
);

CREATE TABLE IF NOT EXISTS members (
  project_id INT REFERENCES projects ON DELETE CASCADE,
  user_id INT REFERENCES users ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS join_requests (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects ON DELETE CASCADE,
  user_id INT REFERENCES users ON DELETE CASCADE,
  message TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects ON DELETE CASCADE,
  user_id INT REFERENCES users ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  assignee_id INT REFERENCES users ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  due_date DATE,
  reminded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_files (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  uploaded_by INT REFERENCES users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_project_id_id_idx ON messages (project_id, id);
CREATE INDEX IF NOT EXISTS tasks_due_date_unreminded_idx ON tasks (due_date) WHERE NOT reminded;
CREATE INDEX IF NOT EXISTS projects_status_created_idx ON projects (status, created_at DESC);
CREATE INDEX IF NOT EXISTS join_requests_project_status_idx ON join_requests (project_id, status);
