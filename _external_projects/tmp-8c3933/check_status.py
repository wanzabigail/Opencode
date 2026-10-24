import urllib.request, os, subprocess
checks = {
    "model_local": "http://127.0.0.1:18080/v1/models",
    "app_healthz": "http://127.0.0.1:8501/healthz",
    "public_site": "https://animate-cardstock-detector.ngrok-free.dev/healthz",
    "public_models": "https://animate-cardstock-detector.ngrok-free.dev/v1/models",
}
for name,url in checks.items():
    try:
        with urllib.request.urlopen(url, timeout=12) as r:
            print(name, "OK", r.status)
    except Exception as e:
        print(name, "FAIL", repr(e))
# endpoints from ngrok url file
print("heartbeat:", open("/marimo/heartbeat.txt").read().strip() if os.path.exists("/marimo/heartbeat.txt") else "missing")
print("watchdog alive:", os.path.exists("/proc/1382"))
