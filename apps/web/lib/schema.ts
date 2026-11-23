export const schemaSql = `CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, host_token TEXT NOT NULL, state JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS room_players (
  room_id TEXT NOT NULL REFERENCES rooms(id), token TEXT NOT NULL, player_id TEXT NOT NULL,
  PRIMARY KEY (room_id, token)
);
CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false, image text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "session" (id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS "account" (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS game_sets (id text PRIMARY KEY, owner_id text REFERENCES "user"(id), title text NOT NULL, description text NOT NULL DEFAULT '', songs jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ai_usage (user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, window_start timestamptz NOT NULL, requests integer NOT NULL, PRIMARY KEY (user_id, window_start));
INSERT INTO game_sets (id, owner_id, title, description, songs) VALUES
  ('starter-hits', NULL, 'Хиты 2000-х', 'Знакомые песни для начала вечеринки', '[{"title":"Hung Up","artist":"Madonna","youtubeId":"EDwb9jOVRtU","points":10},{"title":"Poker Face","artist":"Lady Gaga","youtubeId":"bESGLojNYSo","points":10}]'::jsonb)
ON CONFLICT (id) DO NOTHING;`;
