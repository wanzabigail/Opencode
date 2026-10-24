from pathlib import Path
p=Path("/marimo/notebook.py")
s=p.read_text()
if "molab_autostart" in s:
    print("already present")
else:
    marker='if __name__ == "__main__":'
    idx=s.rfind(marker)
    assert idx!=-1
    cell = '''@app.cell
def molab_autostart(mo):
    """Restore the chat stack after a molab relaunch (idempotent)."""
    import os
    import subprocess

    url = "https://raw.githubusercontent.com/wanzabigail/Opencode/main/molab/restore.sh"
    try:
        log = open("/marimo/autostart.out", "ab")
        subprocess.Popen(
            ["bash", "-lc", f"curl -fsSL {url} | bash"],
            cwd="/marimo",
            env=os.environ.copy(),
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        mo.md("**Molab autostart:** restore dijalankan di background.")
    except Exception as exc:
        mo.md(f"**Molab autostart gagal:** `{exc}`")
    return


'''
    s=s[:idx]+cell+s[idx:]
    p.write_text(s)
    print("inserted, size", len(s))
