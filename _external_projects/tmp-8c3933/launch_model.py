import subprocess, time, os
# kill stale
subprocess.run(["pkill","-f","python3 /marimo/start_model.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
p = subprocess.Popen(["nohup","python3","/marimo/start_model.py"], cwd="/marimo", stdout=open("/marimo/start_model.out","wb"), stderr=subprocess.STDOUT, start_new_session=True)
print("model pid", p.pid)
time.sleep(12)
print("out:", open("/marimo/start_model.out").read()[-600:])
