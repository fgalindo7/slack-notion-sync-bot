#!/bin/bash
# Helper to run the app locally with Docker Compose
#
# Usage:
#   ./scripts/run-local.sh up        # build and start in background
#   ./scripts/run-local.sh down      # stop and remove
#   ./scripts/run-local.sh logs      # follow logs
#   ./scripts/run-local.sh health    # check local health
#
set -e

SERVICE="oncall-auto"
PORT=1987

cmd=${1:-help}

function need_env() {
  if [ ! -f .env ]; then
    echo "    .env not found. Copy .env.template to .env and set values (SLACK_*, NOTION_TOKEN, CHANNEL_DB_MAPPINGS, ALLOW_THREADS)."
    exit 1
  fi
}

case "$cmd" in
  up)
    need_env
    echo "👉 Starting $SERVICE on port $PORT..."
    docker compose up -d --build
    echo "⏳ Waiting for health..."
    for i in {1..20}; do
      if curl -sSf http://localhost:$PORT/health >/dev/null 2>&1; then
        echo "[OK] Healthy at http://localhost:$PORT/health"
        exit 0
      fi
      sleep 2
    done
    echo "    Health endpoint not responding yet. Check logs: ./scripts/run-local.sh logs"
    ;;
  down)
    echo "    Stopping $SERVICE..."
    docker compose down
    ;;
  logs)
    echo "    Following logs for $SERVICE (Ctrl+C to stop)"
    docker compose logs -f $SERVICE
    ;;
  health)
    echo "    Local health:"
    curl -s http://localhost:$PORT/health | jq . 2>/dev/null || curl -s http://localhost:$PORT/health
    echo
    ;;
  *)
    echo "Usage: $0 {up|down|logs|health}"
    exit 1
    ;;
 esac
