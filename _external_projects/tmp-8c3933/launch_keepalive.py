import subprocess
subprocess.run(["pkill","-f","/marimo/keepalive.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
p=subprocess.Popen(["nohup","python3","/marimo/keepalive.py"], cwd="/marimo", stdout=open("/marimo/keepalive.out","wb"), stderr=subprocess.STDOUT, start_new_session=True)
print("keepalive pid", p.pid)
