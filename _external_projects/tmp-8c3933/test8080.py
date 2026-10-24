import urllib.request
for p in [8080,8081,2718]:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{p}/", timeout=3) as r:
            print(p, r.status, r.headers.get("content-type"))
    except Exception as e:
        print(p, "ERR", e)
