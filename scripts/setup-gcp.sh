#!/bin/bash
# Setup script for Google Cloud Platform deployment
# This script creates all necessary GCP resources for hosting On-Call Cat
#
# Prerequisites:
#   - gcloud SDK installed and authenticated
#   - Project ID configured: gcloud config set project YOUR_PROJECT_ID
#
# Usage:
#   ./scripts/setup-gcp.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if PROJECT_ID is set
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID environment variable is not set${NC}"
    echo "Please set it with: export PROJECT_ID='your-gcp-project-id'"
    exit 1
fi

# Check if REGION is set, default to us-central1
if [ -z "$REGION" ]; then
    echo -e "${YELLOW}REGION not set, defaulting to us-central1${NC}"
    export REGION="us-central1"
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}On-Call Cat - GCP Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Confirm before proceeding
read -p "Continue with setup? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

echo ""
echo -e "${GREEN}Step 1: Enabling required APIs...${NC}"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com

echo ""
echo -e "${GREEN}Step 2: Creating Artifact Registry repository...${NC}"
if gcloud artifacts repositories describe oncall-cat --location=$REGION &>/dev/null; then
    echo -e "${YELLOW}Repository 'oncall-cat' already exists${NC}"
else
    gcloud artifacts repositories create oncall-cat \
      --repository-format=docker \
      --location=$REGION \
      --description="On-Call Cat Docker images"
    echo -e "${GREEN}✓ Repository created${NC}"
fi

echo ""
echo -e "${GREEN}Step 3: Configuring Docker authentication...${NC}"
gcloud auth configure-docker ${REGION}-docker.pkg.dev

echo ""
echo -e "${GREEN}Step 4: Granting Cloud Build permissions...${NC}"
# Get project number for the Cloud Build service account
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Granting Artifact Registry Writer role to Cloud Build service accounts..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None \
  > /dev/null 2>&1 || echo -e "${YELLOW}Note: Permission already exists or couldn't be set${NC}"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None \
  > /dev/null 2>&1 || echo -e "${YELLOW}Note: Permission already exists or couldn't be set${NC}"

echo ""
echo -e "${GREEN}Step 5: Granting Vertex AI permissions for AI suggestions...${NC}"
echo "Granting AI Platform User role to Compute service account..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/aiplatform.user" \
  --condition=None \
  > /dev/null 2>&1 || echo -e "${YELLOW}Note: Permission already exists or couldn't be set${NC}"

echo -e "${GREEN}✓ Permissions granted${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Enabled APIs:"
echo "  ✓ Cloud Run"
echo "  ✓ Artifact Registry"
echo "  ✓ Secret Manager"
echo "  ✓ Cloud Build"
echo "  ✓ Vertex AI (for AI-powered suggestions)"
echo ""
echo "Next steps:"
echo "1. Create secrets: ./scripts/create-secrets.sh"
echo "2. Build image: gcloud builds submit --config cloudbuild.yaml"
echo "3. Deploy: ./scripts/deploy-gcp.sh"
echo ""
echo "Optional: Enable AI suggestions by setting AI_SUGGESTIONS_ENABLED=true during deployment"
echo ""
