#!/bin/bash
# Create secrets in Google Secret Manager
# This script creates all required secrets for the On-Call Cat bot
#
# Prerequisites:
#   - gcloud SDK installed and authenticated
#   - Secret Manager API enabled
#   - Secrets ready to be stored
#
# Usage:
#   ./scripts/create-secrets.sh

# Don't exit on error - we want to continue even if some secrets fail
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Creating Secrets in Secret Manager${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Function to create or update a secret
create_or_update_secret() {
    local secret_name=$1
    local secret_description=$2
    local optional=$3
    
    # Check if secret exists
    local secret_exists=false
    if gcloud secrets describe $secret_name &>/dev/null; then
        secret_exists=true
    fi
    
    # If secret exists, ask if user wants to update it
    if [ "$secret_exists" = true ]; then
        echo ""
        echo -e "${BLUE}Secret '${secret_name}' already exists${NC}"
        read -p "Do you want to update it? (y/n/s to skip all remaining) " -n 1 -r
        echo ""
        
        if [[ $REPLY =~ ^[Ss]$ ]]; then
            echo -e "${YELLOW}Skipping remaining secrets...${NC}"
            return 2  # Special return code to skip all
        elif [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Skipping ${secret_name}${NC}"
            return 0
        fi
    else
        # New secret - ask if user wants to create it (for optional secrets)
        if [ "$optional" = "true" ]; then
            echo ""
            echo -e "${YELLOW}Optional secret: ${secret_name}${NC}"
            echo "Description: ${secret_description}"
            read -p "Do you want to create this secret? (y/n) " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo -e "${YELLOW}Skipping ${secret_name}${NC}"
                return 0
            fi
        fi
    fi
    
    echo ""
    echo -e "${YELLOW}${secret_name}${NC}"
    echo "Description: ${secret_description}"
    echo ""
    
    # Prompt for secret value (hidden input)
    read -sp "Enter value for ${secret_name}: " secret_value
    echo ""
    
    if [ -z "$secret_value" ]; then
        echo -e "${RED}Error: Secret value cannot be empty${NC}"
        return 1
    fi
    
    # Create or update secret
    if [ "$secret_exists" = true ]; then
        echo -e "${BLUE}Creating new version...${NC}"
        if echo -n "$secret_value" | gcloud secrets versions add $secret_name --data-file=-; then
            echo -e "${GREEN}✓ Secret ${secret_name} updated${NC}"
        else
            echo -e "${RED}✗ Failed to update ${secret_name}${NC}"
            return 1
        fi
    else
        echo -e "${BLUE}Creating new secret...${NC}"
        if echo -n "$secret_value" | gcloud secrets create $secret_name --data-file=-; then
            echo -e "${GREEN}✓ Secret ${secret_name} created${NC}"
        else
            echo -e "${RED}✗ Failed to create ${secret_name}${NC}"
            return 1
        fi
    fi
}

# Create required secrets
echo -e "${BLUE}Required secrets:${NC}"
echo ""

# Slack Bot Token
create_or_update_secret "slack-bot-token" \
    "Slack Bot User OAuth Token (starts with xoxb-)" \
    "false"
if [ $? -eq 2 ]; then exit 0; fi

# Slack App-Level Token
create_or_update_secret "slack-app-token" \
    "Slack App-Level Token for Socket Mode (starts with xapp-)" \
    "false"
if [ $? -eq 2 ]; then exit 0; fi

# Notion Integration Token (can start with secret_ OR ntn_)
create_or_update_secret "notion-token" \
    "Notion Integration Token (starts with secret_ or ntn_)" \
    "false"
if [ $? -eq 2 ]; then exit 0; fi

# Optional secrets
echo ""
echo -e "${BLUE}Optional secrets:${NC}"

# Slack Signing Secret
create_or_update_secret "slack-signing-secret" \
    "Slack App Signing Secret (for webhooks, not needed for Socket Mode)" \
    "true"
if [ $? -eq 2 ]; then exit 0; fi

# Channel mappings for multi-channel mode
echo ""
if [ -f "channel-mappings.json" ]; then
    # Check if secret exists
    if gcloud secrets describe channel-mappings &>/dev/null; then
        echo -e "${BLUE}Secret 'channel-mappings' already exists${NC}"
        read -p "Do you want to update channel-mappings.json? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Uploading channel-mappings.json...${NC}"
            if gcloud secrets versions add channel-mappings --data-file=channel-mappings.json; then
                echo -e "${GREEN}✓ channel-mappings updated${NC}"
            else
                echo -e "${RED}✗ Failed to update channel-mappings${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}Optional: Channel Mappings (for multi-channel mode)${NC}"
        read -p "Do you want to upload channel-mappings.json? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Uploading channel-mappings.json...${NC}"
            if gcloud secrets create channel-mappings --data-file=channel-mappings.json; then
                echo -e "${GREEN}✓ channel-mappings created${NC}"
            else
                echo -e "${RED}✗ Failed to create channel-mappings${NC}"
            fi
        fi
    fi
else
    echo -e "${YELLOW}channel-mappings.json not found (needed for multi-channel mode)${NC}"
    echo "You can create it later with: cp channel-mappings.json.example channel-mappings.json"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Secret Management Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "To view your secrets:"
echo "  gcloud secrets list"
echo ""
echo "To view a secret value:"
echo "  gcloud secrets versions access latest --secret=SECRET_NAME"
echo ""
echo "To re-run this script and update secrets:"
echo "  ./scripts/create-secrets.sh"
echo ""
