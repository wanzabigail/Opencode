src = r'''import os, json, time, urllib.request

BASE = "http://127.0.0.1:8080"
TOKEN = "54b407978599cd0c47dc4047ac63102c713589c9b4b3e7e699edc5d92c8665c5"
LOG = "/marimo/keepalive.log"
INTERVAL = 300

def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S%z") + " " + msg + "\n")

def req(path, data=None, headers=None):
    h = {"Authorization": "Bearer " + TOKEN}
    if headers:
        h.update(headers)
    body = json.dumps(data).encode() if data is not None else None
    if body:
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=body, headers=h)
    return urllib.request.urlopen(r, timeout=30)

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

# delay so the launch cell can finish
time.sleep(8)
while True:
    try:
        once()
    except Exception as e:
        log("ERR " + repr(e))
    time.sleep(INTERVAL)
'''
open("/marimo/keepalive.py","w").write(src)
import os
os.chmod("/marimo/keepalive.py",0o600)
print("written", len(src))
