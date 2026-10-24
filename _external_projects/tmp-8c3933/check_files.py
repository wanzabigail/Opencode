import os
for f in ["/marimo/start_model.py","/marimo/run_ngrok.py","/marimo/chat_app/app.py","/marimo/chat_app/index.html"]:
    print(f, "exists:", os.path.exists(f), "size:", os.path.getsize(f) if os.path.exists(f) else 0)
# health/model
import urllib.request
for u in ["http://127.0.0.1:18080/v1/models","http://127.0.0.1:8501/healthz"]:
    try:
        print(u, urllib.request.urlopen(u, timeout=3).status)
    except Exception as e:
        print(u, "ERR", e)
