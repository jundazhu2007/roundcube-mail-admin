#!/usr/bin/env bash
# Developer setup (NOT the production installer - that is ./install.sh): creates a venv, installs the backend
# dependencies, builds the frontend and stages a .env. Does not touch systemd, sudoers or the mail stack.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Backend: creating venv and installing dependencies"
python3 -m venv venv
venv/bin/pip install --upgrade pip >/dev/null
venv/bin/pip install -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example - fill in the secrets before starting the API"
fi

if command -v npm >/dev/null 2>&1; then
  echo "==> Frontend: installing dependencies and building"
  (cd frontend && npm ci && npm run build)
else
  echo "==> npm not found, skipping the frontend build (install Node.js 20+ and run: cd frontend && npm ci && npm run build)"
fi

cat <<'MSG'

Setup complete. Next:
  1. Edit .env (JWT secret, break-glass admin hash, database credentials).
  2. Run the API:      set -a; . ./.env; set +a; venv/bin/uvicorn api.main:app --reload
  3. Run the frontend: cd frontend && npm run dev      (proxies /api to localhost:8000)
For a real server use the installer instead:  sudo ./install.sh --help
MSG
