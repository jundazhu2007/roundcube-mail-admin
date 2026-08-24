#!/usr/bin/env bash
# One-command local setup: creates the Python venv, installs backend deps,
# builds the frontend, and stages a .env file. Does not touch systemd or
# sudoers — see README.md for the production deployment steps.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Backend: creating venv and installing dependencies"
python3 -m venv venv
venv/bin/pip install --upgrade pip >/dev/null
venv/bin/pip install -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example — fill in the secrets before starting the API"
fi

if command -v npm >/dev/null 2>&1; then
  echo "==> Frontend: installing dependencies and building"
  (cd frontend && npm ci && npm run build)
else
  echo "==> npm not found, skipping frontend build (install Node.js and run: cd frontend && npm ci && npm run build)"
fi

cat <<'EOF'

Setup complete.

Next steps:
  1. Edit .env with your real secrets (see comments in the file).
  2. Run the API directly for a quick check:
       set -a; source .env; set +a
       venv/bin/uvicorn api.main:app --reload
  3. For a real deployment (systemd unit + sudoers + reverse proxy), see README.md.
EOF
