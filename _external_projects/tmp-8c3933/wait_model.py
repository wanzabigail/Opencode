import time, os, urllib.request
time.sleep(30)
print("pid alive:", os.path.exists("/proc/293"))
try:
    with urllib.request.urlopen("http://127.0.0.1:18080/v1/models", timeout=5) as r:
        print("health OK", r.status, r.read()[:150])
except Exception as e:
    print("health ERR", e)
print("out:")
print(open("/marimo/start_model.out").read()[-1000:])
