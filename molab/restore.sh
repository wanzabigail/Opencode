#!/usr/bin/env bash
# Restore the Molab Qwen chat stack. Safe to run repeatedly.
set -u
BASE="${MOLAB_BOOTSTRAP_BASE:-https://raw.githubusercontent.com/wanzabigail/Opencode/main/molab}"
cd /marimo || exit 1

# Load optional secrets / settings
if [ -f /marimo/.env ]; then
  set -a
  . /marimo/.env
  set +a
fi
NGROK_AUTHTOKEN="${NGROK_AUTHTOKEN:-${NGROK_TOKEN:-}}"
export NGROK_AUTHTOKEN
PAIR_TOKEN="${PAIR_TOKEN:-${MARIMO_TOKEN:-}}"
if [ -n "$PAIR_TOKEN" ]; then
  printf %s "$PAIR_TOKEN" > /marimo/.pair_token
  chmod 600 /marimo/.pair_token
fi

mkdir -p /marimo/chat_app /marimo/models /marimo/llama.cpp

fetch() {
  # fetch <remote-name> <local-path>
  if [ ! -f "$2" ]; then
    curl -fsSL "$BASE/$1" -o "$2" || return 1
  fi
  return 0
}

fetch start_model.py /marimo/start_model.py || true
if [ ! -f /marimo/chat_app/app.py ]; then
  fetch app.py /marimo/chat_app/app.py || true
fi
fetch start_chat.sh /marimo/start_chat.sh || true
fetch anti_mati.sh /marimo/anti_mati.sh || true
fetch keepalive.py /marimo/keepalive.py || true
if [ ! -f /marimo/chat_app/index.html ]; then
  fetch index.html /marimo/chat_app/index.html || true
fi
chmod +x /marimo/start_chat.sh /marimo/anti_mati.sh 2>/dev/null || true

# pyngrok is needed for the tunnel
python3 - <<'PY' >/dev/null 2>&1 || true
import importlib.util, sys, subprocess
if importlib.util.find_spec("pyngrok") is None:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "pyngrok"], check=False)
PY

# Generate the tunnel launcher only when a token is available.
if [ -n "$NGROK_AUTHTOKEN" ]; then
  cat > /marimo/run_ngrok.py <<'PY'
import os, time
from pyngrok import ngrok
ngrok.set_auth_token(os.environ["NGROK_AUTHTOKEN"])
t = ngrok.connect(8501, "http")
print(t.public_url, flush=True)
open("/marimo/ngrok_url.txt", "w").write(t.public_url)
while True:
    time.sleep(3600)
PY
fi

# model
if ! curl -fsS -m 5 http://127.0.0.1:18080/v1/models >/dev/null 2>&1; then
  if ! pgrep -f "python3 /marimo/start_model.py" >/dev/null 2>&1; then
    nohup python3 /marimo/start_model.py >> /marimo/start_model.out 2>&1 &
    echo $! > /marimo/model.pid
  fi
fi

# chat UI
if ! curl -fsS -m 5 http://127.0.0.1:8501/healthz >/dev/null 2>&1; then
  pkill -f "uvicorn app:app" 2>/dev/null || true
  nohup /marimo/start_chat.sh >> /marimo/uvicorn.out 2>&1 &
  echo $! > /marimo/uvicorn.pid
fi

# tunnel
if [ -n "$NGROK_AUTHTOKEN" ] && ! pgrep -f "/marimo/run_ngrok.py" >/dev/null 2>&1; then
  nohup python3 /marimo/run_ngrok.py >> /marimo/ngrok.out 2>&1 &
  echo $! > /marimo/ngrok.pid
fi

# watchdogs
if ! pgrep -f "/marimo/anti_mati.sh" >/dev/null 2>&1; then
  nohup /bin/bash /marimo/anti_mati.sh >> /marimo/antimati_start.out 2>&1 &
  echo $! > /marimo/antimati.pid
fi
if [ -f /marimo/keepalive.py ] && ! pgrep -f "/marimo/keepalive.py" >/dev/null 2>&1; then
  nohup python3 /marimo/keepalive.py >> /marimo/keepalive.out 2>&1 &
  echo $! > /marimo/keepalive.pid
fi

# first heartbeat
date '+%Y-%m-%dT%H:%M:%S%z' > /marimo/heartbeat.txt
echo "restore: model -> http://127.0.0.1:18080/v1 | ui -> http://127.0.0.1:8501 | tunnel file -> /marimo/ngrok_url.txt"
