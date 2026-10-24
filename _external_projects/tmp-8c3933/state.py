import os, urllib.request, subprocess, time
print("heartbeat", open("/marimo/heartbeat.txt").read().strip() if os.path.exists("/marimo/heartbeat.txt") else "missing")
for u in ["http://127.0.0.1:18080/v1/models","http://127.0.0.1:8501/healthz"]:
    try:
        print(u, urllib.request.urlopen(u, timeout=4).status)
    except Exception as e: print(u,"ERR",e)
for kw in ["anti_mati","start_model.py","run_ngrok.py","uvicorn app:app"]:
    print(kw, subprocess.run(["pgrep","-f",kw],capture_output=True,text=True).stdout.strip())
print("files", sorted(os.listdir("/marimo")))
