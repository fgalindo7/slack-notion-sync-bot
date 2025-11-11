#!/bin/bash
# Deploy On-Call Cat to Google Cloud Run
# This script deploys the bot with proper configuration for single or multi-channel mode
#
# Prerequisites:
#   - Docker image built and pushed to Artifact Registry
#   - Secrets created in Secret Manager
#   - PROJECT_ID and REGION environment variables set
#
# Usage:
#   # For single-channel mode:
#   export WATCH_CHANNEL_ID="C1234567890"
#   export NOTION_DATABASE_ID="abc123def456"
#   ./scripts/deploy-gcp.sh
#
#   # For multi-channel mode:
#   export MULTI_CHANNEL=true
#   ./scripts/deploy-gcp.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check required environment variables
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID environment variable is not set${NC}"
    echo "Please set it with: export PROJECT_ID='your-gcp-project-id'"
    exit 1
fi

if [ -z "$REGION" ]; then
    echo -e "${YELLOW}REGION not set, defaulting to us-central1${NC}"
    export REGION="us-central1"
fi

SERVICE_NAME="oncall-cat"
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/oncall-cat/app:latest"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}On-Call Cat - Cloud Run Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Image: $IMAGE_URL"
echo ""

# Determine deployment mode
if [ "$MULTI_CHANNEL" = "true" ]; then
    DEPLOYMENT_MODE="multi-channel"
else
    DEPLOYMENT_MODE="single-channel"
fi

echo -e "${BLUE}Deployment mode: ${DEPLOYMENT_MODE}${NC}"
echo ""

# Build command based on mode
if [ "$DEPLOYMENT_MODE" = "multi-channel" ]; then
    echo -e "${GREEN}Deploying in multi-channel mode...${NC}"
    
    # Check if channel-mappings secret exists
    if ! gcloud secrets describe channel-mappings &>/dev/null; then
        echo -e "${RED}Error: channel-mappings secret not found${NC}"
        echo "Please create it first: ./scripts/create-secrets.sh"
        exit 1
    fi
    
    gcloud run deploy $SERVICE_NAME \
      --image=$IMAGE_URL \
      --platform=managed \
      --region=$REGION \
      --allow-unauthenticated \
      --min-instances=1 \
      --max-instances=3 \
      --memory=512Mi \
      --cpu=1 \
      --timeout=300 \
      --port=1987 \
      --set-env-vars="CHANNEL_DB_MAPPINGS=true,CHANNEL_DB_MAPPINGS_FILE=/secrets/channel-mappings,ALLOW_THREADS=true,API_TIMEOUT=10000,SCHEMA_CACHE_TTL=3600000,HEALTH_PORT=1987,LOG_LEVEL=info" \
      --set-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_APP_LEVEL_TOKEN=slack-app-token:latest,NOTION_TOKEN=notion-token:latest,/secrets/channel-mappings=channel-mappings:latest"
else
    echo -e "${GREEN}Deploying in single-channel mode...${NC}"
    
    # Check required variables for single-channel mode
    if [ -z "$WATCH_CHANNEL_ID" ] || [ -z "$NOTION_DATABASE_ID" ]; then
        echo -e "${RED}Error: Single-channel mode requires WATCH_CHANNEL_ID and NOTION_DATABASE_ID${NC}"
        echo ""
        echo "Please set them:"
        echo "  export WATCH_CHANNEL_ID='C1234567890'"
        echo "  export NOTION_DATABASE_ID='abc123def456'"
        exit 1
    fi
    
    gcloud run deploy $SERVICE_NAME \
      --image=$IMAGE_URL \
      --platform=managed \
      --region=$REGION \
      --allow-unauthenticated \
      --min-instances=1 \
      --max-instances=3 \
      --memory=512Mi \
      --cpu=1 \
      --timeout=300 \
      --port=1987 \
      --set-env-vars="CHANNEL_DB_MAPPINGS=false,WATCH_CHANNEL_ID=${WATCH_CHANNEL_ID},NOTION_DATABASE_ID=${NOTION_DATABASE_ID},ALLOW_THREADS=false,API_TIMEOUT=10000,SCHEMA_CACHE_TTL=3600000,HEALTH_PORT=1987,LOG_LEVEL=info" \
      --set-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_APP_LEVEL_TOKEN=slack-app-token:latest,NOTION_TOKEN=notion-token:latest"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
echo -e "${GREEN}Service URL:${NC} $SERVICE_URL"
echo ""

# Test health endpoint
echo -e "${BLUE}Testing health endpoint...${NC}"
if curl -s "${SERVICE_URL}/health" > /dev/null; then
    echo -e "${GREEN}✓ Health check passed${NC}"
    echo ""
    echo "Health endpoint: ${SERVICE_URL}/health"
    echo "Metrics endpoint: ${SERVICE_URL}/metrics"
else
    echo -e "${YELLOW}⚠ Health check failed (service may still be starting)${NC}"
fi

echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  gcloud run services logs tail $SERVICE_NAME --region=$REGION"
echo ""
echo -e "${BLUE}View service details:${NC}"
echo "  gcloud run services describe $SERVICE_NAME --region=$REGION"
echo ""
