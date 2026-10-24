import os, urllib.request
try:
    with urllib.request.urlopen("http://127.0.0.1:18080/v1/models", timeout=4) as r:
        print("model_ready", r.status)
except Exception as e:
    print("model_waiting", repr(e))
print("heartbeat", open("/marimo/heartbeat.txt").read().strip() if os.path.exists("/marimo/heartbeat.txt") else "missing")
