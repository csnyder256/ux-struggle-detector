#!/usr/bin/env bash
# Clarus Heal - macOS / Linux setup script
#
# What this does:
#   1. Verifies Node.js >= 20 is installed
#   2. Installs pnpm if missing
#   3. Installs project dependencies
#   4. Creates .env from .env.example if missing, with auto-generated secrets
#   5. Builds the runtime SDK bundle
#   6. Prints next steps
#
# Usage:
#   ./scripts/setup.sh
#
# Make it executable first if needed:
#   chmod +x scripts/setup.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Color helpers (only if terminal supports it)
if [ -t 1 ]; then
  CYAN=$'\033[36m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RED=$'\033[31m'
  RESET=$'\033[0m'
else
  CYAN=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

step() { echo "${CYAN}==>${RESET} $*"; }
ok()   { echo "  ${GREEN}ok${RESET} $*"; }
warn() { echo "  ${YELLOW}!${RESET}  $*"; }
fail() { echo "  ${RED}X${RESET}  $*"; exit 1; }

# ----------------------------------------------------------------------------
# 1. Node.js
# ----------------------------------------------------------------------------
step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. Get it from https://nodejs.org/en/download (pick the LTS version)."
fi
NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js >= 20 is required. Found v$NODE_VERSION. Install from https://nodejs.org/en/download"
fi
ok "Node.js v$NODE_VERSION"

# ----------------------------------------------------------------------------
# 2. pnpm
# ----------------------------------------------------------------------------
step "Checking pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found. Installing globally via npm..."
  npm install -g pnpm@latest || fail "Failed to install pnpm. Try manually: npm install -g pnpm"
fi
PNPM_VERSION="$(pnpm --version)"
ok "pnpm v$PNPM_VERSION"

# ----------------------------------------------------------------------------
# 3. Install dependencies
# ----------------------------------------------------------------------------
step "Installing dependencies (this may take a couple minutes)"
pnpm install || fail "pnpm install failed. Check the output above."
ok "Dependencies installed"

# ----------------------------------------------------------------------------
# 4. .env scaffolding
# ----------------------------------------------------------------------------
step "Setting up .env"
if [ ! -f .env.example ]; then
  fail ".env.example missing. Did you delete it? Re-clone the repo."
fi

if [ -f .env ]; then
  warn ".env already exists; leaving it alone. Edit it manually to fill in any missing values."
else
  AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  KEY_ENC="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  CRON_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

  cp .env.example .env

  # Use awk for portable in-place edits (sed -i is BSD/GNU incompatible).
  # Match the whole assignment, whatever placeholder .env.example ships with.
  tmp="$(mktemp)"
  awk -v a="$AUTH_SECRET" -v k="$KEY_ENC" -v c="$CRON_SECRET" '
    /^AUTH_SECRET=/         { print "AUTH_SECRET=\"" a "\""; next }
    /^KEY_ENCRYPTION_KEY=/  { print "KEY_ENCRYPTION_KEY=\"" k "\""; next }
    /^CRON_SECRET=/         { print "CRON_SECRET=\"" c "\""; next }
    { print }
  ' .env > "$tmp"
  mv "$tmp" .env

  # Do not claim success unless the generated values actually landed.
  assert_written() {
    got="$(grep -m1 "^$1=" .env || true)"
    if [ "$got" != "$1=\"$2\"" ]; then
      fail "setup.sh failed to write a generated $1 into .env. Set it by hand (see .env.example)."
    fi
  }
  assert_written AUTH_SECRET        "$AUTH_SECRET"
  assert_written KEY_ENCRYPTION_KEY "$KEY_ENC"
  assert_written CRON_SECRET        "$CRON_SECRET"

  ok ".env created with auto-generated AUTH_SECRET / KEY_ENCRYPTION_KEY / CRON_SECRET"
  warn "You still need to fill in DATABASE_URL and EMAIL_SERVER_* by hand. See GETTING_STARTED.md."
fi

# ----------------------------------------------------------------------------
# 5. SDK bundle
# ----------------------------------------------------------------------------
step "Building the runtime SDK bundle"
if pnpm sdk:build:min >/dev/null 2>&1; then
  ok "SDK bundle: public/sdk.min.js"
else
  warn "SDK build failed; you can re-run with: pnpm sdk:build:min"
fi

# ----------------------------------------------------------------------------
# 6. Next steps
# ----------------------------------------------------------------------------
echo ""
echo "${GREEN}Setup complete.${RESET}"
echo ""
echo "Next steps:"
echo "  1. Open .env and fill in DATABASE_URL (Postgres connection string)"
echo "       and EMAIL_SERVER_* (SMTP, e.g. Resend or Mailtrap)"
echo "  2. Run database migrations:"
echo "       ${CYAN}pnpm db:migrate${RESET}"
echo "  3. Start the dev server:"
echo "       ${CYAN}pnpm dev${RESET}"
echo "  4. Open http://localhost:3000"
echo ""
echo "For step-by-step instructions, see GETTING_STARTED.md."
echo ""
