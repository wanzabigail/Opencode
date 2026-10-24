"""Best-effort molab idle keepalive.

Executes a trivial cell every INTERVAL seconds through the local marimo API.
Token is read from /marimo/.pair_token or MARIMO_TOKEN.
"""
import json
import os
import time
import urllib.request

BASE = os.environ.get("MARIMO_LOCAL_URL", "http://127.0.0.1:8080")
LOG = "/marimo/keepalive.log"
INTERVAL = int(os.environ.get("KEEPALIVE_INTERVAL", "300"))

def read_token():
    t = os.environ.get("MARIMO_TOKEN", "").strip()
    if t:
        return t
    try:
        return open("/marimo/.pair_token").read().strip()
    except OSError:
        return ""

TOKEN = read_token()

def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S%z") + " " + msg + "\n")

def req(path, data=None, headers=None):
    h = {"Authorization": "Bearer " + TOKEN} if TOKEN else {}
    if headers:
        h.update(headers)
    body = json.dumps(data).encode() if data is not None else None
    if body:
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=body, headers=h)
    return urllib.request.urlopen(r, timeout=120)

def once():
    with req("/api/sessions") as r:
        sessions = json.loads(r.read())
    if not sessions:
        log("no session")
        return
    sid = next(iter(sessions))
    with req("/api/kernel/execute", {"code": "pass"}, {"Marimo-Session-Id": sid}) as r:
        while r.read(4096):
            pass
    log("exec ok session=" + sid)

if __name__ == "__main__":
    while True:
        try:
            once()
        except Exception as e:
            log("ERR " + repr(e))
        time.sleep(INTERVAL)
