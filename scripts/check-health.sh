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
