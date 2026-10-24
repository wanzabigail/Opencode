
import json
import os
import subprocess
import time

import httpx

from openai import OpenAI
from starlette.applications import Starlette
from starlette.responses import (
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
    StreamingResponse,
)
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Route

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("MODEL_ALIAS", "qwen3.6-35b-uncensored")
BASE_URL = os.environ.get("MODEL_BASE_URL", "http://127.0.0.1:18080/v1")
KEY = os.environ.get("CHAT_KEY", "")
API_KEY = os.environ.get("API_KEY", "")
if not API_KEY:
    try:
        with open(os.path.join(HERE, "api.key"), encoding="utf-8") as _f:
            API_KEY = _f.read().strip()
    except OSError:
        API_KEY = ""
UPSTREAM = BASE_URL[:-3] if BASE_URL.endswith("/v1") else BASE_URL
DEFAULT_SYSTEM = os.environ.get(
    "SYSTEM_PROMPT",
    "You are Qwen3.6-35B-A3B Uncensored, running locally on the user's GPU. "
    "Answer in the user's language, be direct and concise, and use Markdown when it helps.",
)

client = OpenAI(base_url=BASE_URL, api_key="local", timeout=None)

_vram_cache = {"at": 0.0, "val": None}
_ctx_cache = {"at": 0.0, "val": None}


def _allowed(request) -> bool:
    return not KEY or request.query_params.get("k") == KEY


def _vram():
    now = time.time()
    if _vram_cache["val"] and now - _vram_cache["at"] < 10:
        return _vram_cache["val"]
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip().splitlines()[0]
        used, total = (int(x) for x in out.split(","))
        _vram_cache["val"] = {"used_gb": round(used / 1024, 1), "total_gb": round(total / 1024, 1)}
    except Exception:
        _vram_cache["val"] = None
    _vram_cache["at"] = now
    return _vram_cache["val"]


def _ctx():
    now = time.time()
    if _ctx_cache["val"] and now - _ctx_cache["at"] < 30:
        return _ctx_cache["val"]
    try:
        import urllib.request
        with urllib.request.urlopen(BASE_URL.replace("/v1", "") + "/props", timeout=2) as r:
            _ctx_cache["val"] = json.loads(r.read())["default_generation_settings"]["n_ctx"]
    except Exception:
        _ctx_cache["val"] = None
    _ctx_cache["at"] = now
    return _ctx_cache["val"]


async def index(request):
    if not _allowed(request):
        return HTMLResponse("<h1>403</h1><p>Add ?k=... to the URL.</p>", status_code=403)
    with open(os.path.join(HERE, "index.html"), encoding="utf-8") as f:
        return HTMLResponse(f.read(), headers={"Cache-Control": "no-store"})


async def healthz(request):
    return PlainTextResponse("ok")


async def favicon(request):
    return PlainTextResponse("", status_code=204)


async def status(request):
    return JSONResponse(
        {
            "model": MODEL,
            "alias": MODEL,
            "vram": _vram(),
            "n_ctx": _ctx(),
            "base_url": BASE_URL,
            "ok": True,
        },
        headers={"Cache-Control": "no-store"},
    )


def _sse(obj) -> str:
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


async def chat(request):
    if not _allowed(request):
        return PlainTextResponse("forbidden", status_code=403)
    body = await request.json()

    history = [{"role": "system", "content": body.get("system") or DEFAULT_SYSTEM}]
    for m in body.get("messages", []):
        if m.get("role") in ("user", "assistant"):
            history.append({"role": m["role"], "content": m["content"]})

    def gen():
        started = time.time()
        tokens = 0
        usage = None
        finish = None
        try:
            stream = client.chat.completions.create(
                model=MODEL,
                messages=history,
                max_tokens=int(body.get("max_tokens") or 4096),
                temperature=float(body.get("temperature", 0.7)),
                top_p=float(body.get("top_p", 1.0)),
                extra_body={"chat_template_kwargs": {"enable_thinking": bool(body.get("thinking", True))}},
                stream=True,
                stream_options={"include_usage": True},
            )
            for chunk in stream:
                if getattr(chunk, "usage", None):
                    usage = chunk.usage
                if not chunk.choices:
                    continue
                if chunk.choices[0].finish_reason:
                    finish = chunk.choices[0].finish_reason
                delta = chunk.choices[0].delta
                reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                if reasoning:
                    yield _sse({"r": reasoning})
                if delta.content:
                    tokens += 1
                    yield _sse({"t": delta.content})
            elapsed = max(time.time() - started, 1e-6)
            generated = getattr(usage, "completion_tokens", None) or tokens
            stats = {"secs": round(elapsed, 2), "tokens": generated, "tps": round(generated / elapsed, 1), "finish": finish}
            if usage is not None:
                stats["prompt_tokens"] = getattr(usage, "prompt_tokens", None)
                stats["total_tokens"] = getattr(usage, "total_tokens", None)
            yield _sse({"done": True, "stats": stats})
        except Exception as exc:  # surface problems in the UI, not as a dead stream
            yield _sse({"e": str(exc)})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


async def proxy(request):
    """Passthrough to llama-server (OpenAI-compatible + /props + /tokenize)."""
    if API_KEY:
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {API_KEY}" and request.headers.get("x-api-key") != API_KEY:
            return JSONResponse(
                {"error": {"message": "Invalid API key", "type": "invalid_request_error"}},
                status_code=401,
            )
    url = UPSTREAM + request.url.path
    fwd = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "authorization", "x-api-key", "connection")
    }
    payload = await request.body()
    client = httpx.AsyncClient(timeout=None)
    req = client.build_request(
        request.method, url, headers=fwd, content=payload,
        params=list(request.query_params.multi_items()),
    )
    try:
        upstream = await client.send(req, stream=True)
    except Exception as exc:
        await client.aclose()
        return JSONResponse({"error": {"message": f"upstream unavailable: {exc}"}}, status_code=502)

    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in ("content-length", "content-encoding", "transfer-encoding", "connection")
    }
    out_headers["Cache-Control"] = "no-store"
    out_headers["X-Accel-Buffering"] = "no"

    async def relay():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(relay(), status_code=upstream.status_code, headers=out_headers)


async def catch_all(request):
    return RedirectResponse("/", status_code=307)


app = Starlette(
    routes=[
        Route("/", index),
        Route("/api/chat", chat, methods=["POST"]),
        Route("/api/status", status),
        Route("/v1/{path:path}", proxy, methods=["GET", "POST", "OPTIONS"]),
        Route("/props", proxy, methods=["GET"]),
        Route("/tokenize", proxy, methods=["POST"]),
        Route("/healthz", healthz),
        Route("/favicon.ico", favicon),
        Route("/{path:path}", catch_all),
    ]
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
