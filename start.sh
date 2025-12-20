#!/usr/bin/env bash
set -e
# export all vars from .env into environment
set -a
# if .env doesn't exist this will fail; adjust path if needed
source "$(dirname "$0")/.env"
set +a
exec node "$(dirname "$0")/dist/server.js"
