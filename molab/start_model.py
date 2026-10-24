from pathlib import Path
import os, json, subprocess, time, urllib.request

LLAMA_DIR = Path("/marimo/llama.cpp")
MODEL_DIR = Path("/marimo/models")
MODEL_FILE = MODEL_DIR / "Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf"
MMPROJ_FILE = MODEL_DIR / "mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf"
SERVER_LOG = LLAMA_DIR / "server.log"
REPO = "HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive"
BUILD = "b11829"
BIN_DIR = LLAMA_DIR / f"llama-{BUILD}"
CUDART_DIR = LLAMA_DIR / f"cudart-llama-{BUILD}-bin-ubuntu-cuda-12.8-x64"
HOST, PORT = "127.0.0.1", 18080
BASE_URL = f"http://{HOST}:{PORT}/v1"
MODEL_ALIAS = "qwen3.6-35b-uncensored"
CONTEXT = 262144


def _healthy():
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORT}/v1/models", timeout=3) as r:
            served = json.loads(r.read() or b"{}")
        return any(m.get("id") == MODEL_ALIAS for m in served.get("data", []))
    except Exception:
        return False


def _ensure_assets():
    LLAMA_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if not (BIN_DIR / "llama-server").exists():
        base = f"https://github.com/ggml-org/llama.cpp/releases/download/{BUILD}"
        for asset, out in (
            (f"llama-{BUILD}-bin-ubuntu-cuda-12.8-x64.tar.gz", "bin.tar.gz"),
            (f"cudart-llama-{BUILD}-bin-ubuntu-cuda-12.8-x64.tar.gz", "cudart.tar.gz"),
        ):
            subprocess.run(["curl", "-sL", "-o", out, f"{base}/{asset}"], cwd=LLAMA_DIR, check=True)
            subprocess.run(["tar", "xzf", out], cwd=LLAMA_DIR, check=True)
    missing = [p.name for p in (MODEL_FILE, MMPROJ_FILE) if not p.exists()]
    if missing:
        subprocess.run(["hf", "download", REPO, *missing, "--local-dir", str(MODEL_DIR)], check=True)
    return MODEL_FILE.exists() and MMPROJ_FILE.exists()


def ensure_server(wait_s=900):
    if _healthy():
        return True
    if not _ensure_assets():
        return False
    env = dict(os.environ)
    env["LD_LIBRARY_PATH"] = f"{BIN_DIR}:{CUDART_DIR}"
    cmd = [
        str(BIN_DIR / "llama-server"),
        "-m", str(MODEL_FILE),
        "--mmproj", str(MMPROJ_FILE),
        "-ngl", "99", "-c", str(CONTEXT), "--parallel", "1", "-fa", "on", "--jinja",
        "-t", "12", "--host", HOST, "--port", str(PORT),
        "--alias", MODEL_ALIAS,
    ]
    with open(SERVER_LOG, "a") as log:
        subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    deadline = time.time() + wait_s
    while time.time() < deadline:
        if _healthy():
            return True
        time.sleep(2)
    return False


if __name__ == "__main__":
    print("healthy before:", _healthy(), flush=True)
    print("ensure_server returned:", ensure_server(900), flush=True)
