# Molab Qwen chat bootstrap

Best-effort restore for the Molab sandbox. It cannot bypass Molab's limits:
- 12 hours hard cap -> sandbox is destroyed.
- 90 minutes idle -> sandbox is shut down.

What it does:
- restores the local llama.cpp model server on :18080
- restores the FastAPI chat UI on :8501
- restores the ngrok tunnel (requires NGROK_AUTHTOKEN)
- starts the service watchdog and a best-effort kernel keepalive

## One command after relaunch

```bash
NGROK_AUTHTOKEN=... PAIR_TOKEN=... \
  bash <(curl -fsSL https://raw.githubusercontent.com/wanzabigail/Opencode/main/molab/restore.sh)
```

Or, if `/marimo/restore.sh` still exists:

```bash
NGROK_AUTHTOKEN=... PAIR_TOKEN=... bash /marimo/restore.sh
```

Put secrets in `/marimo/.env` if you do not want them on the command line:

```
NGROK_AUTHTOKEN=...
```

## Autostart cell

The notebook can include this cell to run restore automatically on open:

```python
@app.cell
def _molab_autostart(mo):
    import subprocess
    subprocess.Popen(
        ["bash", "-lc", "curl -fsSL https://raw.githubusercontent.com/wanzabigail/Opencode/main/molab/restore.sh | bash"],
        start_new_session=True,
    )
    return mo.md("Molab autostart aktif.")
```

The 12h/90m limits still apply. For true 24/7, use a persistent GPU host.
