import subprocess
print(subprocess.run("ss -tlnp 2>/dev/null | head -20", shell=True, capture_output=True, text=True).stdout)
