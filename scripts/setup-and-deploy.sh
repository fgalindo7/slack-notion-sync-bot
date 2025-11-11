#!/bin/bash
# Complete end-to-end setup and deployment for GCP
# This is an interactive script that guides you through the entire process
#
# Usage:
#   ./scripts/setup-and-deploy.sh [OPTIONS]
#
# Options:
#   --gcp-project             Run only: Configure GCP Project
#   --deployment-mode         Run only: Choose Deployment Mode
#   --gcp-setup              Run only: Initial GCP Setup (APIs, Registry)
#   --required-secrets       Run only: Configure Required Secrets
#   --optional-secrets       Run only: Configure Optional Secrets
#   --channels-and-dbs       Run only: Configure Channels and Databases
#   --build-image            Run only: Build Docker Image
#   --deploy                 Run only: Deploy to Cloud Run
#   --verify                 Run only: Verification
#   --help                   Show this help message
#
# Examples:
#   # Full deployment
#   ./scripts/setup-and-deploy.sh
#
#   # Update only secrets
#   ./scripts/setup-and-deploy.sh --required-secrets
#
#   # Rebuild and redeploy
#   ./scripts/setup-and-deploy.sh --build-image --deploy

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse command line arguments
RUN_ALL=true
RUN_GCP_PROJECT=false
RUN_DEPLOYMENT_MODE=false
RUN_GCP_SETUP=false
RUN_REQUIRED_SECRETS=false
RUN_OPTIONAL_SECRETS=false
RUN_CHANNELS_DBS=false
RUN_BUILD_IMAGE=false
RUN_DEPLOY=false
RUN_VERIFY=false

# Show help function
show_help() {
    echo "On-Call Cat - GCP Deployment Wizard"
    echo ""
    echo "Usage: ./scripts/setup-and-deploy.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --gcp-project          Configure GCP Project (Step 1)"
    echo "  --deployment-mode      Choose Deployment Mode (Step 2)"
    echo "  --gcp-setup           Initial GCP Setup - APIs, Registry (Step 3)"
    echo "  --required-secrets    Configure Required Secrets (Step 4)"
    echo "  --optional-secrets    Configure Optional Secrets (Step 4 continued)"
    echo "  --channels-and-dbs    Configure Channels and Databases (Step 5)"
    echo "  --build-image         Build Docker Image (Step 6)"
    echo "  --deploy              Deploy to Cloud Run (Step 7)"
    echo "  --verify              Verification (Step 8)"
    echo "  --help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Full deployment (all steps)"
    echo "  ./scripts/setup-and-deploy.sh"
    echo ""
    echo "  # Update only required secrets"
    echo "  ./scripts/setup-and-deploy.sh --required-secrets"
    echo ""
    echo "  # Update channels and redeploy"
    echo "  ./scripts/setup-and-deploy.sh --channels-and-dbs --deploy"
    echo ""
    echo "  # Rebuild and redeploy"
    echo "  ./scripts/setup-and-deploy.sh --build-image --deploy"
    exit 0
}

# Parse arguments
if [ $# -gt 0 ]; then
    RUN_ALL=false
    for arg in "$@"; do
        case $arg in
            --gcp-project)
                RUN_GCP_PROJECT=true
                ;;
            --deployment-mode)
                RUN_DEPLOYMENT_MODE=true
                ;;
            --gcp-setup)
                RUN_GCP_SETUP=true
                ;;
            --required-secrets)
                RUN_REQUIRED_SECRETS=true
                ;;
            --optional-secrets)
                RUN_OPTIONAL_SECRETS=true
                ;;
            --channels-and-dbs)
                RUN_CHANNELS_DBS=true
                ;;
            --build-image)
                RUN_BUILD_IMAGE=true
                ;;
            --deploy)
                RUN_DEPLOY=true
                ;;
            --verify)
                RUN_VERIFY=true
                ;;
            --help|-h)
                show_help
                ;;
            *)
                echo -e "${RED}Unknown option: $arg${NC}"
                echo "Run with --help for usage information"
                exit 1
                ;;
        esac
    done
fi

# If running specific steps, show what will run
if [ "$RUN_ALL" = false ]; then
    echo -e "${BLUE}Running specific steps:${NC}"
    [ "$RUN_GCP_PROJECT" = true ] && echo "  ✓ Configure GCP Project"
    [ "$RUN_DEPLOYMENT_MODE" = true ] && echo "  ✓ Choose Deployment Mode"
    [ "$RUN_GCP_SETUP" = true ] && echo "  ✓ Initial GCP Setup"
    [ "$RUN_REQUIRED_SECRETS" = true ] && echo "  ✓ Configure Required Secrets"
    [ "$RUN_OPTIONAL_SECRETS" = true ] && echo "  ✓ Configure Optional Secrets"
    [ "$RUN_CHANNELS_DBS" = true ] && echo "  ✓ Configure Channels and Databases"
    [ "$RUN_BUILD_IMAGE" = true ] && echo "  ✓ Build Docker Image"
    [ "$RUN_DEPLOY" = true ] && echo "  ✓ Deploy to Cloud Run"
    [ "$RUN_VERIFY" = true ] && echo "  ✓ Verification"
    echo ""
else
    clear
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}║          🐈 On-Call Cat - GCP Deployment Wizard 🐈            ║${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "This wizard will help you deploy On-Call Cat to Google Cloud Platform."
    echo ""
fi

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud SDK is not installed${NC}"
    echo ""
    echo "Please install it first:"
    echo "  macOS: brew install google-cloud-sdk"
    echo "  Other: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Step 1: Project Configuration
if [ "$RUN_ALL" = true ] || [ "$RUN_GCP_PROJECT" = true ]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 1: Configure GCP Project${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Get current project
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
    if [ -n "$CURRENT_PROJECT" ]; then
        echo "Current project: $CURRENT_PROJECT"
        read -p "Use this project? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            export PROJECT_ID="$CURRENT_PROJECT"
        else
            read -p "Enter your GCP Project ID: " PROJECT_ID
            gcloud config set project $PROJECT_ID
        fi
    else
        read -p "Enter your GCP Project ID: " PROJECT_ID
        gcloud config set project $PROJECT_ID
    fi

    echo ""
    read -p "Enter your preferred region (default: us-central1): " REGION
    if [ -z "$REGION" ]; then
        export REGION="us-central1"
    fi

    echo ""
    echo -e "${GREEN}✓ Project configured${NC}"
    echo "  Project ID: $PROJECT_ID"
    echo "  Region: $REGION"
    echo ""
else
    # Load from existing config if not running this step
    export PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")
    export REGION=${REGION:-"us-central1"}
    if [ -z "$PROJECT_ID" ]; then
        echo -e "${RED}Error: No GCP project configured${NC}"
        echo "Please run: ./scripts/setup-and-deploy.sh --gcp-project"
        exit 1
    fi
fi

# Step 2: Deployment Mode
if [ "$RUN_ALL" = true ] || [ "$RUN_DEPLOYMENT_MODE" = true ]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 2: Choose Deployment Mode${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "1) Single-channel mode (one Slack channel → one Notion database)"
    echo "2) Multi-channel mode (multiple channels → multiple databases)"
    echo ""
    read -p "Select mode (1 or 2): " MODE_CHOICE

    if [ "$MODE_CHOICE" = "2" ]; then
        export MULTI_CHANNEL=true
        DEPLOYMENT_MODE="multi-channel"
    else
        export MULTI_CHANNEL=false
        DEPLOYMENT_MODE="single-channel"
    fi

    echo ""
    echo -e "${GREEN}✓ Deployment mode: ${DEPLOYMENT_MODE}${NC}"
    echo ""
fi

# Step 3: Initial Setup
if [ "$RUN_ALL" = true ] || [ "$RUN_GCP_SETUP" = true ]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 3: Initial GCP Setup${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "This will enable required APIs and create infrastructure:"
    echo "  • Cloud Run, Artifact Registry, Secret Manager, Cloud Build"
    echo "  • Vertex AI (for AI-powered similar case suggestions)"
    echo "  • IAM permissions for AI features"
    echo ""
    read -p "Continue? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi

    ./scripts/setup-gcp.sh
fi

# Step 4: Configure Required Secrets
if [ "$RUN_ALL" = true ] || [ "$RUN_REQUIRED_SECRETS" = true ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 4: Configure Required Secrets${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "You'll need to provide:"
    echo "  - Slack Bot Token (xoxb-...)"
    echo "  - Slack App-Level Token (xapp-...)"
    echo "  - Notion Integration Token (starts with secret_ or ntn_)"
    echo ""

    # Check if secrets already exist
    SECRETS_EXIST=false
    if gcloud secrets describe slack-bot-token &>/dev/null && \
       gcloud secrets describe slack-app-token &>/dev/null && \
       gcloud secrets describe notion-token &>/dev/null; then
        SECRETS_EXIST=true
        echo -e "${GREEN}✓ Required secrets already exist${NC}"
        echo ""
        read -p "Do you want to review/update secrets? (y/n) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Skipping secret configuration (using existing secrets)${NC}"
        else
            ./scripts/create-secrets.sh
        fi
    else
        echo -e "${YELLOW}Creating secrets...${NC}"
        echo ""
        ./scripts/create-secrets.sh
    fi
fi

# Step 5: Configure Channels and Databases
if [ "$RUN_ALL" = true ] || [ "$RUN_CHANNELS_DBS" = true ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 5: Configure Channels and Databases${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    if [ "$MULTI_CHANNEL" = "true" ]; then
        echo "Multi-channel mode requires channel-mappings.json"
        echo ""
        
        # Check if file exists
        if [ -f "channel-mappings.json" ]; then
            echo -e "${GREEN}✓ channel-mappings.json found${NC}"
            echo ""
            echo "Current mappings preview:"
            echo "------------------------"
            cat channel-mappings.json | head -20
            echo ""
            read -p "Do you want to edit this file? (y/n) " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                echo -e "${YELLOW}Please edit channel-mappings.json with your actual IDs${NC}"
                echo "Press Enter when ready to continue..."
                read
            fi
        else
            echo -e "${YELLOW}⚠ channel-mappings.json not found${NC}"
            echo ""
            echo "Creating from example..."
            cp channel-mappings.json.example channel-mappings.json
            echo -e "${GREEN}✓ channel-mappings.json created${NC}"
            echo ""
            echo -e "${YELLOW}Please edit channel-mappings.json with your actual channel and database IDs${NC}"
            echo "Press Enter when ready to continue..."
            read
        fi
        
        # Upload channel-mappings to Secret Manager
        echo ""
        echo -e "${BLUE}Uploading channel-mappings.json to Secret Manager...${NC}"
        
        if gcloud secrets describe channel-mappings &>/dev/null; then
            echo -e "${YELLOW}Secret 'channel-mappings' already exists${NC}"
            read -p "Do you want to update it with the current file? (y/n) " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                if gcloud secrets versions add channel-mappings --data-file=channel-mappings.json; then
                    echo -e "${GREEN}✓ channel-mappings updated in Secret Manager${NC}"
                else
                    echo -e "${RED}✗ Failed to update channel-mappings${NC}"
                    exit 1
                fi
            else
                echo -e "${YELLOW}Using existing channel-mappings from Secret Manager${NC}"
            fi
        else
            if gcloud secrets create channel-mappings --data-file=channel-mappings.json; then
                echo -e "${GREEN}✓ channel-mappings created in Secret Manager${NC}"
            else
                echo -e "${RED}✗ Failed to create channel-mappings secret${NC}"
                echo "Please ensure channel-mappings.json is valid JSON"
                exit 1
            fi
        fi
    else
        echo "Single-channel mode configuration:"
        echo ""
        read -p "Enter Slack Channel ID (e.g., C1234567890): " WATCH_CHANNEL_ID
        read -p "Enter Notion Database ID: " NOTION_DATABASE_ID
        export WATCH_CHANNEL_ID
        export NOTION_DATABASE_ID
        echo ""
        echo -e "${GREEN}✓ Configuration saved${NC}"
    fi
fi

# Step 6: Build Docker Image
if [ "$RUN_ALL" = true ] || [ "$RUN_BUILD_IMAGE" = true ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 6: Build Docker Image${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Building and pushing Docker image to Artifact Registry..."
    echo "This may take a few minutes..."
    echo ""
    read -p "Continue? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi

    # Generate a build tag (use git commit or timestamp)
    BUILD_TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "build-$(date +%s)")
    
    echo "Starting async build with tag: ${BUILD_TAG}"
    BUILD_ID=$(gcloud builds submit \
        --config cloudbuild.yaml \
        --substitutions=_REGION=${REGION},_BUILD_TAG=${BUILD_TAG} \
        --async \
        --format="value(id)")
    
    echo ""
    echo -e "${BLUE}Build submitted: ${BUILD_ID}${NC}"
    echo "View logs: https://console.cloud.google.com/cloud-build/builds/${BUILD_ID}"
    echo ""
    echo "Waiting for build to complete..."
    
    # Poll for build status
    while true; do
        STATUS=$(gcloud builds describe ${BUILD_ID} --format="value(status)" 2>/dev/null)
        if [ "$STATUS" = "SUCCESS" ]; then
            echo -e "${GREEN}✓ Build completed successfully${NC}"
            break
        elif [ "$STATUS" = "FAILURE" ] || [ "$STATUS" = "TIMEOUT" ] || [ "$STATUS" = "CANCELLED" ]; then
            echo -e "${RED}✗ Build failed with status: ${STATUS}${NC}"
            echo "View logs: gcloud builds log ${BUILD_ID}"
            exit 1
        else
            echo -n "."
            sleep 5
        fi
    done
fi

# Step 7: Deploy to Cloud Run
if [ "$RUN_ALL" = true ] || [ "$RUN_DEPLOY" = true ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 7: Deploy to Cloud Run${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # Auto-detect deployment mode if not already set
    if [ -z "$MULTI_CHANNEL" ]; then
        if gcloud secrets describe channel-mappings &>/dev/null || [ -f "channel-mappings.json" ]; then
            export MULTI_CHANNEL=true
            echo -e "${BLUE}Auto-detected: Multi-channel mode${NC}"
        else
            export MULTI_CHANNEL=false
            echo -e "${BLUE}Auto-detected: Single-channel mode${NC}"
        fi
    fi
    
    echo ""
    echo "Deploying to Cloud Run..."
    echo ""

    ./scripts/deploy-gcp.sh
fi

# Step 8: Verification
if [ "$RUN_ALL" = true ] || [ "$RUN_VERIFY" = true ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 8: Verification${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Checking service health..."
    sleep 5  # Wait for service to start

    ./scripts/check-health.sh
fi

# Final Summary
if [ "$RUN_ALL" = true ]; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}║                  🎉 Deployment Complete! 🎉                    ║${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo ""
    echo "1. Test in Slack:"
    echo "   - Go to your monitored channel"
    echo "   - Post: @auto Priority: P2 Issue: Test deployment..."
    echo ""
    echo "2. View logs:"
    echo "   ./scripts/view-logs.sh --follow"
    echo ""
    echo "3. Check health:"
    echo "   ./scripts/check-health.sh"
    echo ""
    echo "4. Update configuration:"
    echo "   gcloud run services update oncall-cat --region=$REGION"
    echo ""
    echo -e "${GREEN}Documentation:${NC} docs/GCP_DEPLOYMENT.md"
    echo ""
else
    echo ""
    echo -e "${GREEN}✓ Selected steps completed${NC}"
    echo ""
    echo "To run the full deployment wizard: ./scripts/setup-and-deploy.sh"
    echo "For help: ./scripts/setup-and-deploy.sh --help"
    echo ""
fi
