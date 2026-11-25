# Melody — deploy after GitHub checks, easy return, rollback

## GitHub Checks → Production

The Vercel project is linked to GitHub `alexkochnev1987/melody`.
The Next.js app lives in `apps/web`; the exact Vercel Root Directory
setting is not included in the read-only project metadata exposed here.
Verify in Vercel Project Settings that it points to `apps/web`, where
`vercel.json` lives.

- **Preview deployments are disabled** at the Vercel project level.
- `apps/web/vercel.json` explicitly disables auto-deployments for all
  branches except `main` using `git.deploymentEnabled`.
- `.github/workflows/web-checks.yml` runs **unit tests, ESLint,
  Next.js build and typechecking** on pull requests to `main`. A feature
  branch push without an open PR is intentionally not tested. Duplicate
  checks are avoided by not running both branch push and PR checks.
- GitHub branch protection should require the `Web checks / Unit tests,
  lint, typecheck and build` job before merging. Until this repository
  rule is enabled, CI is validated by the merger before merge, not
  technically enforced by GitHub.
- Only merge after a successful PR CI run and review. The merge into
  `main` triggers **one** Vercel production deployment. GitHub CI
  also checks the resulting main commit.
- No `vercel deploy --prod` is called by CI; no Vercel token is required
  in GitHub Actions.

Vercel docs:
- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/project-configuration/project-settings

## One-tap rejoin (same browser)

1. If localStorage has `melody-session`, the page immediately reopens
   the same room. The existing polling loop resumes when online.
2. If localStorage is lost but the one-year HttpOnly guest cookie
   survives, enter or scan the six-character room code. The client
   sends a POST `{action:"recover",room}` without any player name.
3. The server finds the cookie hash in the room's private identity map
   and returns only the existing player's token, ID, name and score.
   It creates **no player** and gives **no additional starting points**.
4. The browser offers "Вернуться в игру" and shows the restored
   name and balance. The user confirms with one tap.
5. On joining a room, the server also creates a **12-character
   personal recovery code** grouped as `XXXX-XXXX-XXXX`, with 60 bits
   of entropy and a 7-day expiry. The guest can show/copy it from their
   player screen and save it outside the browser (for example, a photo).
6. If a private session closes and loses both localStorage and cookie,
   the player can enter the room ID and their personal code under
   **"Есть личный код восстановления?"** on any browser/device.
7. A successful code redemption **rotates both the recovery code and
   the room player bearer token**, revoking the old device's access.
   Only the existing player and score are restored. The code is stored
   in PostgreSQL as a SHA-256 hash, never plaintext.
8. Without a valid personal code, cookie or previously saved bearer
   token, the room cannot verify the old player's identity.

No secret is placed into a URL or public game snapshot. Room recovery
codes are high-entropy one-time secrets with an expiration, not
guessable six-digit PINs. Treat saved screenshots as confidential.
The personal code works across devices, while the HttpOnly cookie
is convenient for the same device only.

A disconnected participant retains server-side progress. The page
automatically polls and also offers "Подключиться снова".

## Emergency production rollback

If an incorrect production build goes live, use the Vercel Dashboard:
Melody → Deployments → select the previous **READY Production**
deployment → **Rollback** (when offered by the plan/account). Verify
the production alias and a basic game smoke test afterward. If the
Vercel rollback option is unavailable, revert the faulty GitHub merge
and let the reverted `main` commit pass CI and deploy.

If rollback is requested through the connected Vercel application,
the `request_rollback` action can switch production to an earlier
production deployment **without rebuilding**. Confirm the target
deployment first; changing traffic is production-impacting.

**Database warning:** reverting application code does NOT restore or
roll back changes in PostgreSQL. Use the separately tested Neon
recovery procedure for data incidents.
