#!/bin/bash
# View logs from Cloud Run service
# Quick utility to tail logs from the deployed service
#
# Usage:
#   ./scripts/view-logs.sh [--follow]

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$REGION" ]; then
    export REGION="us-central1"
fi

SERVICE_NAME="oncall-cat"

echo -e "${GREEN}Viewing logs for ${SERVICE_NAME} in ${REGION}${NC}"
echo ""

# Use Cloud Logging API instead of gcloud run services logs (which has bugs)
PROJECT=$(gcloud config get-value project 2>/dev/null)

if [ "$1" = "--follow" ]; then
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
