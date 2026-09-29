# Install and update Clarus Heal

## Docker Compose on a trusted server or local machine

Extract the `v0.2.0` deployment bundle from [Releases](https://github.com/csnyder256/ux-struggle-detector/releases), verify SHA-256 against `checksums.txt`, and copy `deploy/.env.example` to `.env`. Generate a different random value for each required secret (`openssl rand -hex 32` for the database password; `openssl rand -base64 32` for each encryption/auth secret). Set the SMTP fields to enable magic-link sign-in. The environment file remains private and is excluded from image builds.

For a **new, empty database**:

```sh
docker compose -p clarus -f compose.yml up -d db
docker compose -p clarus -f compose.yml --profile setup run --rm setup
docker compose -p clarus -f compose.yml up --build -d app
```

Open <http://localhost:3000>. The app runs a production Next.js build as a non-root user; Chromium is included for crawls. PostgreSQL is internal to the Compose network and persists in a named volume. Authentication and ingestion keys are required. Add your site and issue an ingestion key through the application before installing the SDK. Optional model and GitHub integrations still require runtime credentials; see `.env.example` and GITHUB_SETUP.md for their setup. Extend the app's runtime environment explicitly when enabling them.

`AUTH_URL` must match the browser origin; change it together with `CLARUS_PORT`. A public deployment needs HTTPS, a trusted reverse proxy and valid SMTP. This Compose file binds its app port to loopback. The existing `docker-compose.yml` remains the developer database setup; use `-f compose.yml` explicitly for production.

## Vercel or a Node host

The existing `vercel.json` supports Vercel; connect a managed PostgreSQL database and set private runtime environment variables. Initialize only a new database as above (or `pnpm exec prisma db push`). For a Node 22 host, install pnpm 10, run `pnpm install --frozen-lockfile`, `pnpm exec prisma generate`, both SDK build commands and `pnpm build`, then `pnpm start`. Install Chromium and its OS dependencies for crawler jobs (`pnpm exec playwright install --with-deps chromium`). Server and browser SDK belong to the same version.

## Browser SDK distribution

Each release supplies `sdk.js` and `sdk.min.js` as direct downloads alongside the deployment bundles. Serve either from your own origin/CDN and configure its endpoint and site ingestion key as documented in GETTING_STARTED.md. These files do not contain tenant keys. Pin a release and retain the matching LICENSE; do not treat the portfolio Pages site as a running ingestion API.

## Upgrade and rollback

Use `pg_dump` to back up PostgreSQL before updating; keep the previous app release and private environment file. Build the new app and review the Prisma schema difference. Apply any required database change deliberately after taking a backup. The startup command does **not** push or migrate the schema. The setup profile is only for a fresh installation; do not run it automatically on upgrades. Rebuild/restart the app with the same `-p clarus`; retain the database volume. Restore a matching database backup when rolling back an incompatible schema change.
