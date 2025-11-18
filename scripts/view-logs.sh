#!/bin/bash
# View logs from Cloud Run service or local Docker Compose
#
# Usage:
#   ./scripts/view-logs.sh [--follow] [--local]

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

FOLLOW=false
LOCAL=false
for arg in "$@"; do
    case $arg in
        --follow) FOLLOW=true ;;
        --local) LOCAL=true ;;
    esac
done

if [ "$LOCAL" = true ]; then
    # Local logs via Docker Compose
    echo -e "${GREEN}Viewing local logs for oncall-auto (Docker Compose)${NC}"
    if [ "$FOLLOW" = true ]; then
        docker compose logs -f oncall-auto
    else
        docker compose logs --tail=200 oncall-auto
    fi
    exit 0
fi

if [ -z "$REGION" ]; then
        export REGION="us-central1"
fi

SERVICE_NAME="oncall-cat"

echo -e "${GREEN}Viewing logs for ${SERVICE_NAME} in ${REGION}${NC}"
echo ""

# Use Cloud Logging API instead of gcloud run services logs (which has bugs)
PROJECT=$(gcloud config get-value project 2>/dev/null)

if [ "$FOLLOW" = true ]; then
        echo -e "${BLUE}Following logs (Ctrl+C to stop)...${NC}"
        echo -e "${BLUE}Polling every 5 seconds...${NC}"
        echo ""
    
        # Poll for new logs every 5 seconds
        while true; do
                gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}" \
                        --limit=10 \
                        --format="table[no-heading](timestamp.date('%Y-%m-%d %H:%M:%S'),severity,textPayload)" \
                        --freshness=30s \
                        --project=$PROJECT 2>/dev/null || true
                sleep 5
        done
else
        echo -e "${BLUE}Fetching recent logs...${NC}"
        gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}" \
                --limit=50 \
                --format="table(timestamp,severity,textPayload)" \
                --freshness=1h \
                --project=$PROJECT
fi
