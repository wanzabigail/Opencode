import time, os
time.sleep(6)
print("heartbeat exists:", os.path.exists("/marimo/heartbeat.txt"))
if os.path.exists("/marimo/heartbeat.txt"):
    print("heartbeat:", open("/marimo/heartbeat.txt").read().strip())
