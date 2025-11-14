#!/bin/bash
# Check health status of deployed Cloud Run service
#
# Usage:
#   ./scripts/check-health.sh

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$REGION" ]; then
    export REGION="us-central1"
fi

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID not set${NC}"
    exit 1
fi

SERVICE_NAME="oncall-cat"

echo -e "${BLUE}Checking health for ${SERVICE_NAME}...${NC}"
echo ""

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)' 2>/dev/null)

if [ -z "$SERVICE_URL" ]; then
    echo -e "${RED}Service not found or not deployed${NC}"
    exit 1
fi

echo "Service URL: $SERVICE_URL"
echo ""

# Check health endpoint
echo -e "${BLUE}Health Check:${NC}"
HEALTH_RESPONSE=$(curl -s "${SERVICE_URL}/health")
echo "$HEALTH_RESPONSE" | jq '.' 2>/dev/null || echo "$HEALTH_RESPONSE"
echo ""

# Check metrics endpoint
echo -e "${BLUE}Metrics:${NC}"
METRICS_RESPONSE=$(curl -s "${SERVICE_URL}/metrics")
echo "$METRICS_RESPONSE" | jq '.' 2>/dev/null || echo "$METRICS_RESPONSE"
echo ""

# Parse health status
STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status' 2>/dev/null)
if [ "$STATUS" = "healthy" ]; then
    echo -e "${GREEN}✓ Service is healthy${NC}"
else
    echo -e "${RED}✗ Service is unhealthy${NC}"
fi

# Check deployed version/build time
DEPLOYED_BUILD_TIME=$(echo "$HEALTH_RESPONSE" | jq -r '.buildTime' 2>/dev/null)
DEPLOYED_VERSION=$(echo "$HEALTH_RESPONSE" | jq -r '.version' 2>/dev/null)

if [ "$DEPLOYED_BUILD_TIME" != "null" ] && [ "$DEPLOYED_BUILD_TIME" != "unknown" ]; then
    # Get the latest local git commit info
    LATEST_COMMIT=$(git log -1 --format='%H %ai' 2>/dev/null || echo "unknown")
    
    echo -e "${BLUE}Deployed version:${NC} $DEPLOYED_VERSION (built at $DEPLOYED_BUILD_TIME)"
    
    # Get current revision's creation time from Cloud Run
    CURRENT_REVISION=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.latestReadyRevisionName)' 2>/dev/null)
    REVISION_CREATE_TIME=$(gcloud run revisions describe $CURRENT_REVISION --region=$REGION --format='value(metadata.creationTimestamp)' 2>/dev/null)
    
    if [ -n "$LATEST_COMMIT" ] && [ "$LATEST_COMMIT" != "unknown" ]; then
        COMMIT_TIME=$(echo "$LATEST_COMMIT" | awk '{print $2, $3, $4}')
        COMMIT_HASH=$(echo "$LATEST_COMMIT" | awk '{print substr($1,1,7)}')
        echo -e "${BLUE}Latest local commit:${NC} $COMMIT_HASH at $COMMIT_TIME"
        
        # Convert times to epoch for comparison
        DEPLOYED_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$DEPLOYED_BUILD_TIME" +%s 2>/dev/null || echo "0")
        COMMIT_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S %z" "$COMMIT_TIME" +%s 2>/dev/null || echo "0")
        
        # If deployed time is after commit time (with 60 second buffer), it's current
        TIME_DIFF=$((DEPLOYED_EPOCH - COMMIT_EPOCH))
        
        if [ $TIME_DIFF -ge -60 ]; then
            echo -e "${GREEN}✓ Service is running the latest deployment${NC}"
        else
            echo -e "${RED}⚠ Service may be running an older deployment${NC}"
            echo -e "${RED}  Deployed build is $((-TIME_DIFF)) seconds older than latest commit${NC}"
        fi
    fi
else
    echo -e "${RED}⚠ Unable to determine deployment version${NC}"
fi
