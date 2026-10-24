#!/usr/bin/env bash
set -u
cd /marimo/chat_app || exit 1
exec python3 -m uvicorn app:app --host 0.0.0.0 --port 8501
