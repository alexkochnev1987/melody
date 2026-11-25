# Melody — deploy after GitHub checks, easy return, rollback

## GitHub Checks → Production

The Vercel project is linked to GitHub `alexkochnev1987/melody`, and
its application Root Directory is `apps/web`.

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
5. If the cookie no longer exists (e.g. private session closed),
   recovery cannot be established and the normal Join flow remains.

The recovery token is never placed into a URL or public game snapshot.
The browser only receives the token after proving possession of the
previous room-bound HttpOnly cookie. It is not an email/social account
and does not work across devices.

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
