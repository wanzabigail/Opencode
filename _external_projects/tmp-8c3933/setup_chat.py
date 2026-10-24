import subprocess, sys, os, time
try:
    import pyngrok
    print("pyngrok already installed")
except Exception:
    print("pip install pyngrok")
    r = subprocess.run([sys.executable,"-m","pip","install","pyngrok"], capture_output=True, text=True, timeout=200)
    print("exit", r.returncode, r.stdout[-200:], r.stderr[-200:])
# start uvicorn if not running
running=False
try:
    import urllib.request
    with urllib.request.urlopen("http://127.0.0.1:8501/healthz", timeout=2) as r:
        running = r.status==200
except: running=False
print("uvicorn running:", running)
if not running:
    p=subprocess.Popen(["nohup","/bin/bash","-c","cd /marimo/chat_app && exec python3 -m uvicorn app:app --host 0.0.0.0 --port 8501"],
                       stdout=open("/marimo/uvicorn.out","wb"), stderr=subprocess.STDOUT, start_new_session=True)
    print("uvicorn pid", p.pid)
    time.sleep(5)
    print(open("/marimo/uvicorn.out").read()[-500:])
