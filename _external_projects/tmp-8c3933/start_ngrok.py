import subprocess, time, os
subprocess.run(["pkill","-f","/marimo/run_ngrok.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
p=subprocess.Popen(["nohup","python3","/marimo/run_ngrok.py"], cwd="/marimo", stdout=open("/marimo/ngrok.out","wb"), stderr=subprocess.STDOUT, start_new_session=True)
print("ngrok launcher pid", p.pid)
found=False
for _ in range(30):
    time.sleep(2)
    if os.path.exists("/marimo/ngrok_url.txt"):
        url=open("/marimo/ngrok_url.txt").read().strip()
        print("URL", url)
        found=True
        break
if not found:
    print("still waiting; tail:")
    print(open("/marimo/ngrok.out").read()[-1200:])
