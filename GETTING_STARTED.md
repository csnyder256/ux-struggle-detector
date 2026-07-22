# Getting Started

This guide assumes **you've never set up a JavaScript project before**. We'll go step by step. If you already know what a terminal is, what Node is, and what Postgres is, jump to the [Quickstart](#quickstart) at the bottom.

There are five things this app needs to run:

1. **Node.js** - the language runtime
2. **pnpm** - the package manager (we install Node packages with this)
3. **Postgres** - the database
4. An **SMTP email account** - so the app can send sign-in links to your inbox
5. The project files - already on your computer if you're reading this

We'll walk through each.

---

## Step 1 - Pick a terminal

A "terminal" is the window where you type commands. You probably already have one:

- **Windows:** open the Start menu and search for **PowerShell**. Click it.
- **macOS:** press `Cmd+Space`, type **Terminal**, press Enter.
- **Linux:** you know what to do.

Keep that window open - you'll be typing commands into it for the rest of this guide.

The "current directory" is the folder the terminal is "looking at." Whenever a command says to **`cd`** somewhere, that means change the current directory. To check what folder you're in:

- Windows: `pwd`
- macOS / Linux: `pwd`

---

## Step 2 - Install Node.js

Node is the JavaScript runtime that powers this app.

1. Go to <https://nodejs.org/en/download>
2. Download the **LTS** version (the bigger green button) for your operating system.
3. Run the installer. Click **Next** through everything; the defaults are fine.
4. Close and re-open your terminal so it picks up the new install.
5. Verify:

   ```
   node --version
   ```

   You should see something like `v22.x.x`. If you see "command not found," restart your computer and try again.

> **What version is required?** Anything 20 or higher.

---

## Step 3 - Get into the project folder

If you got this project as a zip file, **unzip it first**. Pick a folder you'll remember (e.g. `Documents/clarus-heal`).

Then in your terminal:

```
cd path/to/clarus-heal
```

Replace `path/to/clarus-heal` with the actual path. To check you're in the right place:

```
ls
```

You should see files like `package.json`, `README.md`, and folders like `src/` and `prisma/`. If you don't, you're in the wrong folder.

---

## Step 4 - Run the setup script

There's a script that handles all the boring stuff (installing pnpm, installing dependencies, generating secrets, building the SDK bundle).

**Windows (PowerShell):**

```
.\scripts\setup.ps1
```

If you see an error like `cannot be loaded because running scripts is disabled`, run this once first:

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

then try the setup script again.

**macOS / Linux:**

```
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The script will:

- Confirm Node.js is installed and recent enough
- Install **pnpm** if you don't have it
- Run `pnpm install` (downloads ~500 MB of packages - give it a couple minutes)
- Create a `.env` file with auto-generated random secrets
- Build the SDK bundle so the demo page works

When it's done, you'll see a "Setup complete" message and a list of next steps.

> **What if the script fails?** Read the error. The most common one is "no internet" - check your connection and re-run the script. It's safe to run multiple times.

---

## Step 5 - Set up the database (Postgres)

The app stores everything in Postgres. You have two options:

**Pick ONE of the options below.** If you do Option A, do NOT do Option B (and vice versa).

### Option A - Docker Desktop (easiest if you're new)

1. Download Docker Desktop: <https://www.docker.com/products/docker-desktop/>
2. Install it. Open it. Wait until the whale icon in the system tray says "Docker is running."
3. In your terminal, in the project folder, run:

   ```
   docker run --name clarus-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=clarus_heal -p 5432:5432 -d postgres:16
   ```

   This starts a Postgres database on your computer in a container. The `POSTGRES_DB=clarus_heal` part **automatically creates the `clarus_heal` database** - you do NOT need to run `createdb` afterward.

4. Open the `.env` file in any text editor. Find the line that starts with `DATABASE_URL=`. Set it to:

   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/clarus_heal?schema=public"
   ```

✓ **You're done with this step. Skip Option B entirely and jump to [Step 6](#step-6--set-up-email-so-you-can-sign-in).**

To stop the database later: `docker stop clarus-pg`. To start it again: `docker start clarus-pg`.

### Option B - Postgres installed directly (skip if you did Option A)

- **macOS:** install [Postgres.app](https://postgresapp.com), click Initialize.
- **Windows:** download the installer from <https://www.postgresql.org/download/windows/>. Pick a password during install and remember it. During install, also check the option to add `psql`/`createdb` to your PATH (or you'll get "command not recognized" errors later).
- **Linux:** `sudo apt install postgresql` (or your distro's equivalent).

Then create the database (Option B only - Docker users don't need this):

```
createdb clarus_heal
```

And set the `DATABASE_URL` in `.env` accordingly. The format is:

```
postgresql://USER:PASSWORD@localhost:5432/clarus_heal?schema=public
```

---

## Step 6 - Set up email (only if REQUIRE_AUTH=true)

By default the app runs in **open-access mode** - no sign-in, every visitor operates against a shared "Demo Workspace" Org. **You can skip this step entirely for dev.**

Set `REQUIRE_AUTH=true` in `.env` only when you want to lock the app down (e.g., before sharing a public deployment). Then the magic-link sign-in kicks in and you'll need SMTP creds.

The app uses **magic-link sign-in** - you type your email, it sends you a one-time link, you click it, you're signed in. That means it needs SMTP credentials.

The easiest free option is **Resend** (<https://resend.com>). Sign up (free, no credit card), then:

1. From the Resend dashboard, go to **API Keys** → **Create API Key**. Copy the key (starts with `re_`).
2. Open `.env` and set:

   ```
   EMAIL_SERVER_HOST="smtp.resend.com"
   EMAIL_SERVER_PORT="465"
   EMAIL_SERVER_USER="resend"
   EMAIL_SERVER_PASSWORD="re_xxxxxxxxxxxxx"
   EMAIL_FROM="onboarding@resend.dev"
   ```

   `EMAIL_FROM` can stay as `onboarding@resend.dev` until you add a verified domain to Resend.

If you don't want to use Resend, any SMTP provider works (Postmark, SendGrid, your own mail server, Mailtrap for dev-only).

---

## Step 7 - Run database migrations

Now that `DATABASE_URL` is set, create the tables:

```
pnpm db:migrate
```

If it asks "Enter a name for the new migration:" type something like `init` and press Enter.

You should see "Your database is now in sync with your schema."

---

## Step 8 - Start the app

```
pnpm dev
```

After 5-10 seconds, you'll see something like:

```
   ▲ Next.js 15.x.x
   - Local:        http://localhost:3000
```

Open <http://localhost:3000> in your browser. You should see the Clarus Heal landing page.

To stop the server, click the terminal window and press `Ctrl+C`.

---

## Step 9 - Try it end-to-end

1. Click **Try it now** on the landing page.
2. **In default open-access mode** you go straight into the wizard (no sign-in). In auth mode (`REQUIRE_AUTH=true`) you'll get the magic-link flow first.
3. **Step 1 - Platform info.** Type a name + description. Continue.
4. **Step 2 - API keys.** Paste your Anthropic and/or OpenAI keys (or click *Skip* - you can add them later from Settings).
5. **Step 3 - SDK install.** Copy the script tag and paste it into your app, or click **Open demo** to see the renderers in action.
6. **Step 4 - Repo mapping** (optional). Paste an absolute path to a project folder on the server. The framework auto-detector + universal parser run inline; you'll see element / route counts after.
7. **Step 5 - Done.** Summary + jump to the dashboard.

Welcome to the dashboard. Sidebar has SDK, Repos, Flow Map, Friction Points, Element Breakdown, Interventions, Sessions, and Settings.

## Step 10 - see it in action without writing any client code

If you don't have an app to integrate with yet, two paths to see the dashboard come alive:

**Path A - synthetic seed.** Go to <http://localhost:3000/dashboard/settings>, click **Seed demo data**. The dashboard fills with 8 mapped UI elements, 8 sessions of synthetic events, 16 struggle events across 8 detection types, and 6 element/struggle pairs carrying 12 intervention variants with realistic counts.

**Path B - drive it from the SDK demo page.**

1. Go to <http://localhost:3000/dashboard/install> and copy your `orgId`.
2. Open <http://localhost:3000/demo/?live=1&orgId=YOUR_ORG_ID> in a new tab. The green LIVE banner confirms the SDK is posting to `/api/events`.
3. Click around - buttons, the form, the search bar. Every click flows into the dashboard. Click the red "broken" button 3+ times to fire a rage-click intervention.
4. Refresh <http://localhost:3000/dashboard> to see your sessions, struggles, and interventions populate.

You can also click **Ping /api/events** on `/dashboard/install` to round-trip a synthetic event server-side without leaving the dashboard.

---

## What's optional?

- **GitHub onboarding path.** If you want the "Connect GitHub" flow to work, follow [GITHUB_SETUP.md](GITHUB_SETUP.md). It's a one-time admin step (registering a GitHub App).
- **Crawler onboarding path.** Implemented and usable without any admin setup: `/onboarding/crawler` runs the HTTP crawler and falls back to the Playwright crawler for SPA shells. Playwright browsers are not installed by `pnpm install`, so run `pnpm exec playwright install chromium` first if you want the SPA path.

---

## Common problems

### "pnpm: command not found" after running the setup script

Close the terminal, open a fresh one, try again. pnpm puts itself on the PATH but the running terminal session may not know yet.

### "Connection refused" when running `pnpm db:migrate`

Postgres isn't running. If using Docker: `docker start clarus-pg`. If installed directly: start the Postgres service through your OS's settings.

### "P3014" or "P1000" errors from Prisma

Wrong `DATABASE_URL`. Open `.env`, double-check user/password/host. The format is `postgresql://USER:PASSWORD@localhost:5432/clarus_heal?schema=public`.

### Magic-link emails never arrive

Check Resend (or whatever provider) for "delivered" status. If it shows delivered but your inbox doesn't have it, check your spam folder. If it never delivers, the SMTP credentials are wrong - re-check them in `.env`.

### `pnpm dev` works but the page shows a 500 error

Look at the terminal where `pnpm dev` is running - the error will be there. Most often: missing env var, or migrations weren't run.

### "Module not found" errors

```
pnpm install
```

That fixes most of these.

---

## Quickstart

For when you've done this before:

```
./scripts/setup.sh           # or .\scripts\setup.ps1 on Windows
docker run --name clarus-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=clarus_heal -p 5432:5432 -d postgres:16
# edit .env: set DATABASE_URL + EMAIL_SERVER_*
pnpm db:migrate
pnpm dev
```

---

## Where to go next

- [README.md](README.md) - high-level project overview.
- [GITHUB_SETUP.md](GITHUB_SETUP.md) - register a GitHub App for the "Connect GitHub" path.
- `prisma/schema.prisma` - the 23-model data model, if you're going to modify the code.
- `src/lib/types/` - the single sources of truth shared by the parser, the SDK, and the server.
