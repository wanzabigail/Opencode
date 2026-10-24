import os, urllib.request
print("model pid alive:", os.path.exists("/proc/293"))
if os.path.exists("/proc/293/cmdline"):
    print(open("/proc/293/cmdline","rb").read().replace(b"\x00",b" ").decode("utf-8","replace"))
try:
    with urllib.request.urlopen("http://127.0.0.1:18080/v1/models", timeout=3) as r:
        print("health OK", r.status, r.read()[:200])
except Exception as e:
    print("health ERR", e)
print("out:")
print(open("/marimo/start_model.out").read()[-500:])
