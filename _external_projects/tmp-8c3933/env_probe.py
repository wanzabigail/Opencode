import os
keys=[k for k in os.environ if any(s in k.upper() for s in ["MOLAB","MARIMO","SANDBOX","HOST","URL","TOKEN","API","PORT","SESSION","NOTEBOOK"])]
for k in sorted(keys):
    v=os.environ[k]
    if any(s in k.upper() for s in ["TOKEN","KEY","SECRET","PASSWORD"]):
        v=v[:6]+"..."+v[-4:] if len(v)>12 else "***"
    print(k,"=",v[:200])
