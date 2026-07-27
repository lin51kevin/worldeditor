#!/usr/bin/env bash
# serve-dist-nginx.sh — serve frontend/dist using the nginx.exe bundled with
# RoadNetworkRTService, WITHOUT touching that service's own nginx.conf.
#
# Runs a second, independent nginx instance with its own prefix directory
# (.nginx-local/: conf + logs + temp) and its own port, so it never conflicts
# with the RoadNetworkRTService instance already listening on 8067.
#
# Usage:
#   scripts/serve-dist-nginx.sh [start|stop|reload] [port]
#
# Env overrides:
#   NGINX_BIN  path to nginx.exe (default: RoadNetworkRTService's copy)
#   DIST_DIR   path to the built frontend (default: frontend/dist)

set -euo pipefail

# Resolve to Windows drive-letter form (F:/...) — required inside nginx.conf
# for the native nginx.exe binary; git-bash/MSYS accepts this form for file
# ops too, so the same path string works for both.
winpath() { ( cd "$1" && { pwd -W 2>/dev/null || pwd; } ); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(winpath "$SCRIPT_DIR/..")"

NGINX_BIN="${NGINX_BIN:-F:/Builds/MnemoGS_cooperation_20260702090447_91/Tools/RoadNetworkRTService/nginx.exe}"
NGINX_HOME="$(dirname "$NGINX_BIN")"
DIST_DIR="${DIST_DIR:-$REPO_ROOT/frontend/dist}"
WORK_DIR="$REPO_ROOT/.nginx-local"
CONF_FILE="$WORK_DIR/nginx.conf"
ACTION="${1:-start}"
PORT="${2:-${PORT:-8090}}"

if [[ ! -f "$NGINX_BIN" ]]; then
  echo "error: nginx.exe not found at $NGINX_BIN" >&2
  echo "  Override with: NGINX_BIN=/path/to/nginx.exe $0 $ACTION" >&2
  exit 1
fi

case "$ACTION" in
  stop)
    "$NGINX_BIN" -p "$WORK_DIR" -c "$CONF_FILE" -s stop
    echo "nginx (frontend/dist) stopped."
    exit 0
    ;;
  reload)
    "$NGINX_BIN" -p "$WORK_DIR" -c "$CONF_FILE" -s reload
    echo "nginx (frontend/dist) reloaded."
    exit 0
    ;;
  start)
    ;;
  *)
    echo "usage: $0 [start|stop|reload] [port]" >&2
    exit 1
    ;;
esac

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "error: $DIST_DIR/index.html not found. Build it first: just build-web" >&2
  exit 1
fi

mkdir -p "$WORK_DIR/logs" "$WORK_DIR/temp"

cat > "$CONF_FILE" <<EOF
worker_processes  1;
error_log  logs/error.log;
pid        logs/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       $NGINX_HOME/conf/mime.types;
    default_type  application/octet-stream;
    types { application/wasm wasm; }

    sendfile   on;
    gzip       on;
    gzip_types application/javascript application/wasm application/json text/css image/svg+xml;
    access_log logs/access.log;

    server {
        listen      $PORT;
        server_name localhost;
        root        $DIST_DIR;
        index       index.html;

        location /assets/ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        location / {
            add_header Cache-Control "no-cache";
            try_files \$uri \$uri/ /index.html;
        }
    }
}
EOF

"$NGINX_BIN" -p "$WORK_DIR" -c "$CONF_FILE"
echo "nginx started -> http://localhost:$PORT  (serving $DIST_DIR)"
echo "stop with: $0 stop"
