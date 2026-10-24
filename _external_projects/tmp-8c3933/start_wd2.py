import subprocess, time, os
# avoid duplicate watchdog
out = subprocess.run(["pgrep","-f","/marimo/anti_mati.sh"],capture_output=True,text=True).stdout.strip()
if out:
    print("watchdog already running:", out)
else:
    p=subprocess.Popen(["nohup","/bin/bash","/marimo/anti_mati.sh"], cwd="/marimo", stdout=open("/marimo/antimati_start.out","wb"), stderr=subprocess.STDOUT, start_new_session=True)
    print("watchdog pid", p.pid)
    time.sleep(3)
    print("heartbeat:", open("/marimo/heartbeat.txt").read().strip() if os.path.exists("/marimo/heartbeat.txt") else "missing")
