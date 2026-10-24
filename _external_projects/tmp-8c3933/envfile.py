import os
for f in ["/marimo/.env","/marimo/.config/marimo/marimo.toml"]:
    print("==",f)
    try: print(open(f).read()[:1000])
    except Exception as e: print(e)
