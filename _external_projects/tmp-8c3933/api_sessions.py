import urllib.request, json
token="54b407978599cd0c47dc4047ac63102c713589c9b4b3e7e699edc5d92c8665c5"
for hdrs in [{}, {"Authorization":"Bearer "+token}]:
    req=urllib.request.Request("http://127.0.0.1:8080/api/sessions", headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            print("ok", r.status, r.read()[:400])
    except Exception as e:
        print("err", e, getattr(e,'read',lambda:b'')()[:200])
