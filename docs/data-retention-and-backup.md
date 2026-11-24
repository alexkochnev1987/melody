# Melody data persistence, guest profiles and database recovery

## What persists

- `game_sets` holds organizer playlists, categories, YouTube IDs, and the
  chosen pregame clues; updates are stored in PostgreSQL JSONB.
- `rooms.state` holds the room game state, bids, players, scores,
  score events, completed rounds, and timestamps.
- `room_players` contains per-room bearer tokens for rejoining.
- A guest receives a **one-year HttpOnly, SameSite=Lax, Secure-on-HTTPS**
  browser cookie. Only its SHA-256 fingerprint is recorded in
  `rooms.state.identityHashes`; the secret is never included in API JSON.
- `GET /api/profile` summarizes that guest's history across rooms on the
  same browser. `POST /api/profile` can associate the last legacy room
  using the existing participant token. No SQL migration is required.
- The cookie is a guest identity, **not an account**. Clearing the browser's
  site data, switching browser/device, or losing the cookie loses access to
  older guest history even though rows remain in PostgreSQL.
  Cross-device Google account linking is future work.
- Historical rooms with no guest identity still work, but cannot be
  attributed to a new guest without proof via the original room token.
- No application-level data-retention deletion job currently exists.

## Neon recovery verification — NOT YET CONFIRMED

On 2026-11-24, the available connected Neon organization returned **zero
projects**. This is not enough to verify the Neon project that is actually
used by Vercel's production `DATABASE_URL`. Vercel's integration listing
was forbidden (403), so the true project ID and its PITR configuration remain
unverified. Do not create a new Neon project or change the app's connection
string as a substitute.

Before calling backups configured, an authorized operator should:

1. In Vercel Project → Settings → Environment Variables, identify which
   Neon project owns `DATABASE_URL`, without copying credentials into tickets
   or chat. Confirm Production versus Preview scopes.
2. Connect that **same** Neon project/account and read its project settings
   (`history_retention_seconds`), branches, and snapshots.
3. Verify PITR retention matches business expectations. As of October 2026,
   Neon's Free plan advertises a six-hour instant-restore window, which is
   **not** a substitute for an independent daily backup.
4. Test an actual restore into a *temporary branch*, compare row counts and
   several historical room/playlist results, then delete only the temporary
   test branch. Do not overwrite the live production branch during a drill.
5. For longer-term protection, configure an encrypted offsite daily
   `pg_dump` export to an access-controlled destination, monitor failures,
   define retention, and periodically test restoring the backup. Use a
   restricted database credential and do not store dumps in Git or expose
   connection strings to CI logs.
6. Document the restore-point objective (RPO), recovery-time objective
   (RTO), last tested restore, and person who can access backups.

Current status: **application persistence confirmed in code; PITR settings,
snapshot availability, daily backup and tested recovery not confirmed**.

Official Neon reference:
- https://neon.com/blog/neon-free-plan-1-gb-per-project
- https://neon.com/storage
