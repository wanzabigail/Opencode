import time, os, urllib.request
time.sleep(10)
print("model pid alive:", os.path.exists("/proc/293"))
try:
    with urllib.request.urlopen("http://127.0.0.1:18080/v1/models", timeout=5) as r:
        print("model health", r.status, r.read()[:150])
except Exception as e:
    print("model health ERR", e)
try:
    with urllib.request.urlopen("http://127.0.0.1:8501/healthz", timeout=5) as r:
        print("app health", r.status)
except Exception as e:
    print("app health ERR", e)
try:
    with urllib.request.urlopen("https://animate-cardstock-detector.ngrok-free.dev/healthz", timeout=15) as r:
        print("public root", r.status)
except Exception as e:
    print("public root ERR", e)
