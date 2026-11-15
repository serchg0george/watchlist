#!/usr/bin/env bash
# Load / unload the local Qwen model and its API server in LM Studio. The LM Studio app itself is never closed.
# Usage: scripts/qwen.sh up | down | status
#   up     — ensure the server on :1234, load qwen3.8-27b as `qwen-local`
#   down   — unload `qwen-local` (frees the RAM) and stop the server; the app keeps running
#   status — one line: LOADED / DOWN
# Env: QWEN_MODEL (default qwen3.8-27b), QWEN_CTX (default 131072 — needs K/V cache quantization Q8_0
#      saved in the LM Studio Load panel; with f16 KV cache the max that fits is 98304).
# Other load settings (GPU offload, flash attention, MTP, KV quantization) come from the model's
# saved LM Studio load config.
set -u
lms=${LMS:-$HOME/.lmstudio/bin/lms}
[[ -x "$lms" ]] || lms=$(command -v lms) || { echo "lms not found (LM Studio CLI)" >&2; exit 1; }
model=${QWEN_MODEL:-qwen3.8-27b}
ctx=${QWEN_CTX:-131072}

loaded() { "$lms" ps 2>/dev/null | grep -q "qwen-local"; }

case "${1:-status}" in
  up)
    "$lms" server start >/dev/null 2>&1 || { echo "qwen: server start failed" >&2; exit 2; }
    if ! loaded; then
      # --estimate-only ignores K/V quantization (says 43.6 GB / "will fail" for 131k; real ≈37 GB
      # with Q8_0), so just try and fall back to 98304 if the load fails.
      "$lms" load "$model" --identifier qwen-local -c "$ctx" --parallel 1 -y >/dev/null 2>&1 || {
        echo "qwen: load at ctx $ctx failed — retrying with 98304" >&2; ctx=98304
        "$lms" load "$model" --identifier qwen-local -c "$ctx" --parallel 1 -y >/dev/null 2>&1 \
          || { echo "qwen: load failed" >&2; exit 2; }
      }
    fi
    loaded && echo "qwen: LOADED ($model, ctx $ctx, :1234)" || { echo "qwen: not loaded" >&2; exit 2; }
    ;;
  down)
    loaded && "$lms" unload qwen-local >/dev/null 2>&1
    loaded && { echo "qwen: unload failed" >&2; exit 2; }
    "$lms" server stop >/dev/null 2>&1
    echo "qwen: DOWN (model unloaded, server stopped)"
    ;;
  status)
    if loaded; then echo "qwen: LOADED — unload with scripts/qwen.sh down after the session is pushed"; else echo "qwen: DOWN"; fi
    ;;
  *) echo "usage: $0 up|down|status" >&2; exit 1 ;;
esac
