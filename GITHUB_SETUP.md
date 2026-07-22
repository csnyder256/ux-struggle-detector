# GitHub App setup

The "Connect GitHub" onboarding path requires a GitHub App. This is a **one-time admin step** - once configured, every user on this Clarus Heal deployment can install the app on their own GitHub repos.

If you're just running the app locally to try it out, you can skip this entire file. The Direct setup (BYO-keys) onboarding path works without GitHub.

---

## What's a GitHub App?

GitHub Apps are GitHub's modern integration model. Compared to OAuth Apps:

- They authenticate as the **app**, not as a user - your users don't share their personal GitHub credentials with you.
- They use **fine-grained permissions** - you only ask for "Read code" + "Read metadata," nothing else.
- They're **installable per-repo** - users pick which repos to grant access to.
- They send **webhooks** - push events trigger re-mapping automatically.

---

## Step 1 - Create the app

1. Open <https://github.com/settings/apps/new>
   - For an **organization-owned** app instead, use `https://github.com/organizations/YOUR_ORG/settings/apps/new`.
2. Fill in the form:

   | Field | Value |
   |---|---|
   | **GitHub App name** | `Clarus Heal` (or any unique name; spaces become dashes in the slug) |
   | **Homepage URL** | `http://localhost:3000` (dev) or your production URL |
   | **Identifying and authorizing users** - Callback URL | leave empty (we don't use user-to-server OAuth yet) |
   | **Setup URL (optional)** | `http://localhost:3000/api/github/callback` |
   | **Redirect on update** | check the box |
   | **Webhook** | Active = checked |
   | **Webhook URL** | `http://localhost:3000/api/github/webhook` (see "Webhooks for local dev" below) |
   | **Webhook secret** | generate a random string and save it. `openssl rand -hex 32` is fine. |
   | **Where can this GitHub App be installed?** | "Only on this account" for testing, "Any account" for production |

3. **Repository permissions:**

   | Permission | Access |
   |---|---|
   | Contents | Read-only |
   | Metadata | Read-only |
   | Pull requests | Read-only (optional, only if you want PR-triggered re-mapping) |

4. **Subscribe to events:**

   - `Push` - for re-mapping on every push to default branch
   - `Installation` - for tracking installs / uninstalls
   - `Installation repositories` - for tracking repo selection changes

5. Click **Create GitHub App**.

---

## Step 2 - Collect the credentials

After creation, GitHub takes you to the app's settings page. Note:

- **App ID** - top of the page, a number like `123456`.
- **Client ID** - middle of the page, starts with `Iv1.` or `Iv23.`.

Then:

1. Click **Generate a new client secret**. Copy it now - you can't see it again.
2. Scroll down to **Private keys**. Click **Generate a private key**. A `.pem` file downloads.

Keep the `.pem` file safe - anyone with it can authenticate as your app.

---

## Step 3 - Encode the private key

The PEM file is multi-line, which doesn't fit in a `.env` file cleanly. Base64-encode it onto a single line:

**macOS / Linux:**

```bash
base64 -w 0 < clarus-heal.private-key.pem
```

(Some `base64` versions don't support `-w 0`. If yours doesn't, use `cat clarus-heal.private-key.pem | base64 | tr -d '\n'`.)

**Windows (PowerShell):**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("clarus-heal.private-key.pem"))
```

Copy the resulting single-line string.

---

## Step 4 - Set the env vars

Open `.env` and fill in the GitHub block:

```
GITHUB_APP_NAME="clarus-heal"            # the slug from your app's URL (github.com/apps/<slug>)
GITHUB_APP_ID="123456"                   # the App ID from step 2
GITHUB_APP_CLIENT_ID="Iv23.abcd..."      # Client ID from step 2
GITHUB_APP_CLIENT_SECRET="abc123..."     # Client Secret from step 2
GITHUB_APP_PRIVATE_KEY="LS0tLS1CRUdJTi..."  # base64 string from step 3 (single line)
GITHUB_APP_WEBHOOK_SECRET="<the secret you generated>"
```

Restart the dev server so the new env vars load.

---

## Step 5 - Verify

1. Open <http://localhost:3000/onboarding/github>.
2. You should see a **Connect GitHub** card (instead of the "Server setup required" message).
3. Click **Install on GitHub**. You'll be redirected to GitHub's install dialog.
4. Pick a repo (or all repos). Click **Install**.
5. GitHub redirects you back to `/onboarding/github?status=installed`. The page now shows your installation + the repos it can access.

If you see "GitHub did not return an installation_id," double-check the **Setup URL** in the app settings - it must be exactly `http://localhost:3000/api/github/callback`.

---

## Webhooks for local dev

GitHub's webhooks need a **publicly reachable URL**. `localhost` doesn't work. Two options:

### Option A - ngrok

1. Install ngrok: <https://ngrok.com/download>
2. In a separate terminal: `ngrok http 3000`
3. Copy the `https://...ngrok.io` URL it prints.
4. Update your GitHub App's **Webhook URL** to `https://<ngrok-id>.ngrok.io/api/github/webhook`.
5. Update **Setup URL** to `https://<ngrok-id>.ngrok.io/api/github/callback`.
6. Update `AUTH_URL` in `.env` to `https://<ngrok-id>.ngrok.io`.

### Option B - skip webhooks during development

In the GitHub App settings, uncheck **Webhook** → **Active**. The Connect GitHub onboarding path still works; you just won't get auto re-mapping on push. You can manually trigger a re-map from the dashboard.

---

## Going to production

When you deploy:

1. Update the GitHub App's URLs (Homepage, Setup URL, Webhook URL) to your production domain.
2. Set the same env vars on the production environment.
3. The `GITHUB_APP_PRIVATE_KEY` env var stays the same - same base64 string everywhere.

Or create a separate GitHub App for production, with its own credentials, and use those env vars in production. This is cleaner because dev installs and prod installs don't get mixed.

---

## Revoking access

To uninstall the app from a repo, the user goes to:

```
https://github.com/settings/installations
```

(or `https://github.com/organizations/YOUR_ORG/settings/installations` for org-owned installs).

Clarus Heal will receive an `installation` webhook and mark the installation as removed; the dashboard will show the repos as no longer mapped.
