import os, glob, json
for base in ["/marimo/.config","/marimo/__marimo__","/home/marimo/.config","/home/marimo/.marimo","/home/marimo/.local/state"]:
    print("==",base)
    for root,dirs,files in os.walk(base):
        for f in files[:50]:
            p=os.path.join(root,f)
            print(p, os.path.getsize(p) if os.path.exists(p) else 0)
