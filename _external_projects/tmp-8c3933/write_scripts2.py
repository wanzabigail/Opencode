start_chat = """#!/usr/bin/env bash
set -u
cd /marimo/chat_app || exit 1
exec python3 -m uvicorn app:app --host 0.0.0.0 --port 8501
"""
open("/marimo/start_chat.sh","w").write(start_chat)
import os
os.chmod("/marimo/start_chat.sh",0o755)

watchdog = r'''#!/usr/bin/env bash
set -u
cd /marimo
UV_API="http://127.0.0.1:8501/healthz"
NGROK_URL="https://animate-cardstock-detector.ngrok-free.dev/"
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> /marimo/anti_mati.log; }
curl_ok() { curl -fsS -m 8 "$1" >/dev/null 2>&1; }
while true; do
    if ! curl_ok "http://127.0.0.1:18080/v1/models"; then
        if pgrep -f "python3 /marimo/start_model.py" >/dev/null 2>&1; then
            log "model: booting/downloading"
        else
            log "model: unhealthy -> start_model.py"
            nohup python3 /marimo/start_model.py >> /marimo/start_model.out 2>&1 &
            echo $! > /marimo/model.pid
        fi
    fi
    if ! curl_ok "$UV_API"; then
        log "uvicorn: unhealthy -> start_chat.sh"
        pkill -f "uvicorn app:app" 2>/dev/null || true
        sleep 1
        nohup /marimo/start_chat.sh >> /marimo/uvicorn.out 2>&1 &
        echo $! > /marimo/uvicorn.pid
    fi
    if ! curl_ok "$NGROK_URL"; then
        log "ngrok: endpoint down -> restart"
        pkill -f "/marimo/run_ngrok.py" 2>/dev/null || true
        sleep 1
        nohup python3 /marimo/run_ngrok.py >> /marimo/ngrok.out 2>&1 &
        echo $! > /marimo/ngrok_wd.pid
    fi
    date '+%Y-%m-%dT%H:%M:%S%z' > /marimo/heartbeat.txt
    sleep 20
done
'''

open("/marimo/anti_mati.sh","w").write(watchdog)
os.chmod("/marimo/anti_mati.sh",0o755)
print("scripts written")
