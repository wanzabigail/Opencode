import base64
print(base64.b64encode(open("/marimo/chat_app/app.py","rb").read()).decode())
