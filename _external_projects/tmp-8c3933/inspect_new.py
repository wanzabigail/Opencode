import os, glob
print("CWD", os.getcwd())
print("TOP", sorted(os.listdir(".")))
print("NOTEBOOK exists", os.path.exists("notebook.py"))
if os.path.exists("chat_app"):
    print("chat_app", sorted(os.listdir("chat_app")))
print("ngrok binary tools?")
import shutil
for x in ["curl","python3","uvicorn","cloudflared","ngrok"]:
    print(x, shutil.which(x))
