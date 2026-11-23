# Melody

Music guessing game with a Next.js host dashboard, player rooms, Google sign-in, and song generation.

## Configuration

Copy .env.example to .env and fill in the values. DATABASE_URL must point to PostgreSQL, including during local development. The app no longer starts an embedded database. Keep .env outside Git.

The Google OAuth client needs this redirect URI for each deployed hostname:

    https://<your-hostname>/api/auth/callback/google

Set BETTER_AUTH_URL to the exact application origin, such as https://melody.vercel.app. Use a long random BETTER_AUTH_SECRET. The AI and YouTube keys are server-side only.

## Database

Run npm run db:migrate with DATABASE_URL set before the first deployment. The migration creates tables and the starter public game.

To copy the existing local PGlite data once, stop the old development server and run npm run db:copy-local from apps/web with DATABASE_URL pointing to the empty target PostgreSQL database. The copy checks that the target has no user data, writes the rows in one transaction, and leaves the local database files untouched.

## Run

    npm ci
    npm run dev

## Deploy

The Vercel project's Root Directory is apps/web and its runtime is Node.js 24. Connect a PostgreSQL database in Vercel Storage for Production and Preview, configure the environment variables above, and deploy the repository. Update the Google OAuth redirect URI to match the final HTTPS domain.
