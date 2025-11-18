#!/bin/bash
# Unified health check wrapper for local and GCP
#
# Usage:
#   ./scripts/check-health.sh [--json] [--local|--gcp] [--url=http://localhost:1987]

set -e

BLUE='\033[0;34m'
NC='\033[0m'

TARGET="gcp"
JSON_FLAG=""
CUSTOM_URL=""

for arg in "$@"; do
    case $arg in
        --json)
            JSON_FLAG="--json";
            shift ;;
        --local)
            TARGET="local"; shift ;;
        --gcp)
            TARGET="gcp"; shift ;;
        --url=*)
            CUSTOM_URL="${arg#*=}"; shift ;;
        *)
            shift ;;
    esac
done

echo -e "${BLUE}Running health check (${TARGET})...${NC}"

if [ "$TARGET" = "local" ]; then
    URL_FLAG=""
    if [ -n "$CUSTOM_URL" ]; then URL_FLAG="--url=$CUSTOM_URL"; else URL_FLAG="--url=http://localhost:1987"; fi
    node scripts/check-health.mjs $JSON_FLAG --target=local $URL_FLAG
else
    node scripts/check-health.mjs $JSON_FLAG --target=gcp
fi
