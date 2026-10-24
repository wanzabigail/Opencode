import os, subprocess
print("anti_mati.sh exists:", os.path.exists("/marimo/anti_mati.sh"), os.path.getsize("/marimo/anti_mati.sh") if os.path.exists("/marimo/anti_mati.sh") else 0)
print("start_chat.sh exists:", os.path.exists("/marimo/start_chat.sh"))
print("heartbeat:", os.path.exists("/marimo/heartbeat.txt"))
# pgrep
for kw in ["anti_mati","start_model.py","run_ngrok.py","uvicorn app:app"]:
    print(kw, subprocess.run(["pgrep","-f",kw],capture_output=True,text=True).stdout.strip())
