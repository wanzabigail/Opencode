import time, os, subprocess
time.sleep(15)
print("alive:", os.path.exists("/proc/11693"))
print(open("/marimo/keepalive.log").read() if os.path.exists("/marimo/keepalive.log") else "no log")
print("out:", open("/marimo/keepalive.out").read()[-500:])
