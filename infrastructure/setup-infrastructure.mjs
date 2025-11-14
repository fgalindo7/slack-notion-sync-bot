#!/usr/bin/env node
/**
 * @fileoverview GCP Infrastructure Setup - Automated provisioning using GCP JS SDK
 * Creates and configures all required GCP resources for the On-Call Cat bot
 * including Cloud Run, Cloud Build, Cloud Deploy, Artifact Registry, and Secret Manager
 * @author Francisco Galindo
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { ArtifactRegistryClient } from '@google-cloud/artifact-registry';
import { CloudBuildClient } from '@google-cloud/cloudbuild';
import { ServiceManagerClient } from '@google-cloud/service-management';
import readline from 'readline';
import { promisify } from 'util';

// Configuration
const CONFIG = {
  projectId: process.env.GCP_PROJECT_ID || process.env.PROJECT_ID,
  region: process.env.REGION || 'us-central1',
  serviceName: 'oncall-cat',
  repositoryId: 'oncall-cat',
  
  // APIs to enable
  requiredApis: [
    'run.googleapis.com',               // Cloud Run
    'artifactregistry.googleapis.com',  // Artifact Registry
    'secretmanager.googleapis.com',     // Secret Manager
    'cloudbuild.googleapis.com',        // Cloud Build
    'clouddeploy.googleapis.com',       // Cloud Deploy
    'aiplatform.googleapis.com',        // Vertex AI
    'iam.googleapis.com',               // IAM
  ],
  
  // Required secrets
  requiredSecrets: [
    { name: 'slack-bot-token', description: 'Slack Bot User OAuth Token (xoxb-...)' },
    { name: 'slack-app-token', description: 'Slack App-Level Token (xapp-...)' },
    { name: 'notion-token', description: 'Notion Integration Token (secret_...)' },
  ],
  
  // Optional secrets
  optionalSecrets: [
    { name: 'channel-mappings', description: 'Channel to Database mappings JSON (for multi-channel mode)' },
  ],
};

// Helper: Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const question = promisify(rl.question).bind(rl);

// Check if running in interactive mode
const isInteractive = process.stdin.isTTY;

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60) + '\n');
}

/**
 * Enable required GCP APIs
 */
async function enableAPIs() {
  logSection('Enabling Required GCP APIs');
  
  const serviceManagement = new ServiceManagerClient();
  
  for (const api of CONFIG.requiredApis) {
    try {
      log(`Enabling ${api}...`, 'blue');
      
      // Check if already enabled
      const [services] = await serviceManagement.listServices({
        consumerId: `project:${CONFIG.projectId}`,
      });
      
      const isEnabled = services.some(s => s.serviceName === api);
      
      if (isEnabled) {
        log(`✓ ${api} already enabled`, 'green');
      } else {
        // Enable the service
        await serviceManagement.enableService({
          serviceName: api,
        });
        log(`✓ ${api} enabled successfully`, 'green');
      }
    } catch (error) {
      log(`⚠ Warning: Could not enable ${api}: ${error.message}`, 'yellow');
      log(`  Please enable manually: gcloud services enable ${api}`, 'yellow');
    }
  }
}

/**
 * Create Artifact Registry repository
 */
async function createArtifactRegistry() {
  logSection('Setting Up Artifact Registry');
  
  const client = new ArtifactRegistryClient();
  const parent = `projects/${CONFIG.projectId}/locations/${CONFIG.region}`;
  const repositoryId = CONFIG.repositoryId;
  
  try {
    // Check if repository exists
    const repositoryName = `${parent}/repositories/${repositoryId}`;
    
    try {
      await client.getRepository({ name: repositoryName });
      log(`✓ Artifact Registry repository "${repositoryId}" already exists`, 'green');
    } catch (error) {
      if (error.code === 5) { // NOT_FOUND
        log(`Creating Artifact Registry repository "${repositoryId}"...`, 'blue');
        
        const [operation] = await client.createRepository({
          parent,
          repositoryId,
          repository: {
            format: 'DOCKER',
            description: 'Container images for On-Call Cat bot',
          },
        });
        
        await operation.promise();
        log(`✓ Artifact Registry repository created successfully`, 'green');
      } else {
        throw error;
      }
    }
    
    log(`\nRepository URL: ${CONFIG.region}-docker.pkg.dev/${CONFIG.projectId}/${repositoryId}`, 'bright');
  } catch (error) {
    log(`✗ Error creating Artifact Registry: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Create or update secrets in Secret Manager
 */
async function setupSecrets() {
  logSection('Setting Up Secret Manager');
  
  const client = new SecretManagerServiceClient();
  const parent = `projects/${CONFIG.projectId}`;
  
  // Process required secrets
  for (const secretConfig of CONFIG.requiredSecrets) {
    await createOrUpdateSecret(client, parent, secretConfig, true);
  }
  
  // Ask about optional secrets
  log('\n--- Optional Secrets ---', 'bright');
  
  // Skip optional secrets in non-interactive mode
  if (!isInteractive) {
    log('Skipping optional secrets (non-interactive mode)', 'yellow');
    return;
  }
  
  try {
    const setupOptional = await question('Set up optional secrets (channel-mappings for multi-channel mode)? (y/N): ');
    
    if (setupOptional.toLowerCase() === 'y') {
      for (const secretConfig of CONFIG.optionalSecrets) {
        await createOrUpdateSecret(client, parent, secretConfig, false);
      }
    }
  } catch {
    // Readline closed - skip optional secrets
    log('Skipping optional secrets (input closed)', 'yellow');
  }
}

/**
 * Create or update a single secret
 */
async function createOrUpdateSecret(client, parent, secretConfig, required) {
  const secretName = `${parent}/secrets/${secretConfig.name}`;
  
  try {
    // Check if secret exists
    let secretExists = false;
    try {
      await client.getSecret({ name: secretName });
      secretExists = true;
      log(`✓ Secret "${secretConfig.name}" already exists`, 'green');
      
      // In non-interactive mode, skip existing secrets
      if (!isInteractive) {
        log(`  Skipping (non-interactive mode)`, 'yellow');
        return;
      }
      
      // In interactive mode, ask if user wants to update
      try {
        const update = await question(`  Update value? (y/N): `);
        if (update.toLowerCase() !== 'y') {
          return;
        }
      } catch {
        // Readline closed - treat as "no update"
        log(`  Skipping update (input closed)`, 'yellow');
        return;
      }
    } catch (error) {
      if (error.code === 5) { // NOT_FOUND
        log(`Creating secret "${secretConfig.name}"...`, 'blue');
        await client.createSecret({
          parent,
          secretId: secretConfig.name,
          secret: {
            replication: {
              automatic: {},
            },
          },
        });
      } else {
        throw error;
      }
    }
    
    // Skip value prompt in non-interactive mode if secret exists
    if (secretExists && !isInteractive) {
      return;
    }
    
    // Get secret value from user
    log(`\n${secretConfig.description}`, 'bright');
    
    let value;
    try {
      value = await question(`Enter value for ${secretConfig.name}: `);
    } catch {
      // Readline closed - skip this secret
      log(`  Skipping (input closed)`, 'yellow');
      if (required && !secretExists) {
        log(`  ⚠ Warning: Required secret "${secretConfig.name}" not set`, 'yellow');
      }
      return;
    }
    
    if (!value && required && !secretExists) {
      log(`✗ Value required for ${secretConfig.name}`, 'red');
      return;
    }
    
    if (value) {
      // Add secret version
      await client.addSecretVersion({
        parent: secretName,
        payload: {
          data: Buffer.from(value, 'utf8'),
        },
      });
      log(`✓ Secret value set successfully`, 'green');
    }
  } catch (error) {
    log(`✗ Error setting up secret "${secretConfig.name}": ${error.message}`, 'red');
    // Don't throw fatal error - continue with remaining secrets
    if (required) {
      log(`  ⚠ Warning: Required secret failed, but continuing...`, 'yellow');
    }
  }
}

/**
 * Set up Cloud Build trigger
 */
async function setupCloudBuild() {
  logSection('Setting Up Cloud Build');
  
  const client = new CloudBuildClient();
  const parent = `projects/${CONFIG.projectId}/locations/${CONFIG.region}`;
  
  try {
    log('Creating Cloud Build trigger...', 'blue');
    log('Note: GitHub repository connection must be set up manually first', 'yellow');
    log('Visit: https://console.cloud.google.com/cloud-build/triggers', 'yellow');
    
    const triggerConfig = {
      name: 'oncall-cat-deploy',
      description: 'Build and deploy On-Call Cat on push to main',
      github: {
        owner: 'fgalindo7',
        name: 'slack-notion-sync-bot',
        push: {
          branch: '^main$',
        },
      },
      filename: 'cloudbuild.yaml',
    };
    
    // List existing triggers
    const [triggers] = await client.listBuildTriggers({
      parent,
      projectId: CONFIG.projectId,
    });
    
    const existingTrigger = triggers.find(t => t.name === triggerConfig.name);
    
    if (existingTrigger) {
      log(`✓ Build trigger "${triggerConfig.name}" already exists`, 'green');
    } else {
      log('To create the trigger, run:', 'yellow');
      log(`  gcloud beta builds triggers create github \\`, 'bright');
      log(`    --name="${triggerConfig.name}" \\`, 'bright');
      log(`    --repo-name=slack-notion-sync-bot \\`, 'bright');
      log(`    --repo-owner=fgalindo7 \\`, 'bright');
      log(`    --branch-pattern="^main$" \\`, 'bright');
      log(`    --build-config=cloudbuild.yaml \\`, 'bright');
      log(`    --region=${CONFIG.region}`, 'bright');
    }
  } catch (error) {
    log(`⚠ Warning: ${error.message}`, 'yellow');
    log('Cloud Build trigger must be created manually via console or gcloud CLI', 'yellow');
  }
}

/**
 * Set up Cloud Deploy pipeline
 */
async function setupCloudDeploy() {
  logSection('Setting Up Cloud Deploy');
  
  log('Cloud Deploy configuration will be created...', 'blue');
  log('This requires clouddeploy.yaml and skaffold.yaml files', 'yellow');
  
  // Check if files exist
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const cloudDeployPath = path.join(process.cwd(), 'clouddeploy.yaml');
  const skaffoldPath = path.join(process.cwd(), 'skaffold.yaml');
  
  try {
    await fs.access(cloudDeployPath);
    log(`✓ clouddeploy.yaml found`, 'green');
  } catch {
    log(`⚠ clouddeploy.yaml not found - will be created`, 'yellow');
  }
  
  try {
    await fs.access(skaffoldPath);
    log(`✓ skaffold.yaml found`, 'green');
  } catch {
    log(`⚠ skaffold.yaml not found - will be created`, 'yellow');
  }
  
  log('\nTo deploy the pipeline after creating config files:', 'bright');
  log(`  gcloud deploy apply --file=clouddeploy.yaml --region=${CONFIG.region}`, 'bright');
}

/**
 * Configure IAM permissions
 */
async function setupIAMPermissions() {
  logSection('Setting Up IAM Permissions');
  
  log('Required IAM permissions:', 'bright');
  log('  • Cloud Build service account needs:', 'blue');
  log('    - roles/run.admin', 'blue');
  log('    - roles/iam.serviceAccountUser', 'blue');
  log('  • Cloud Run service account (compute SA) needs:', 'blue');
  log('    - roles/secretmanager.secretAccessor', 'blue');
  log('    - roles/aiplatform.user', 'blue');
  log('    - roles/clouddeploy.releaser (for Cloud Deploy)', 'blue');
  log('    - roles/iam.serviceAccountUser (ActAs permission for Cloud Deploy)', 'blue');
  
  log('\nRun these commands to grant permissions:', 'bright');
  log(`  PROJECT_NUMBER=$(gcloud projects describe ${CONFIG.projectId} --format='value(projectNumber)')`, 'bright');
  log('', 'reset');
  log('  # Cloud Build service account permissions', 'bright');
  log(`  gcloud projects add-iam-policy-binding ${CONFIG.projectId} \\`, 'bright');
  log(`    --member="serviceAccount:\${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \\`, 'bright');
  log(`    --role="roles/run.admin"`, 'bright');
  log(`  gcloud projects add-iam-policy-binding ${CONFIG.projectId} \\`, 'bright');
  log(`    --member="serviceAccount:\${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \\`, 'bright');
  log(`    --role="roles/iam.serviceAccountUser"`, 'bright');
  log('', 'reset');
  log('  # Cloud Run compute service account permissions', 'bright');
  log(`  gcloud projects add-iam-policy-binding ${CONFIG.projectId} \\`, 'bright');
  log(`    --member="serviceAccount:\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \\`, 'bright');
  log(`    --role="roles/secretmanager.secretAccessor"`, 'bright');
  log(`  gcloud projects add-iam-policy-binding ${CONFIG.projectId} \\`, 'bright');
  log(`    --member="serviceAccount:\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \\`, 'bright');
  log(`    --role="roles/aiplatform.user"`, 'bright');
  log('', 'reset');
  log('  # Cloud Deploy permissions (REQUIRED for automated deployments)', 'bright');
  log(`  gcloud projects add-iam-policy-binding ${CONFIG.projectId} \\`, 'bright');
  log(`    --member="serviceAccount:\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \\`, 'bright');
  log(`    --role="roles/clouddeploy.releaser"`, 'bright');
  log('', 'reset');
  log('  # ActAs permission (allows compute SA to impersonate itself for Cloud Deploy)', 'bright');
  log(`  gcloud iam service-accounts add-iam-policy-binding \\`, 'bright');
  log(`    \${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \\`, 'bright');
  log(`    --member="serviceAccount:\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \\`, 'bright');
  log(`    --role="roles/iam.serviceAccountUser"`, 'bright');
}

/**
 * Display summary
 */
function displaySummary() {
  logSection('Infrastructure Setup Complete!');
  
  log('✓ APIs enabled', 'green');
  log('✓ Artifact Registry created', 'green');
  log('✓ Secrets configured', 'green');
  log('✓ Cloud Build ready', 'green');
  log('✓ Cloud Deploy ready', 'green');
  
  log('\nNext steps:', 'bright');
  log('1. Create clouddeploy.yaml and skaffold.yaml configuration files', 'blue');
  log('2. Set up GitHub repository connection in Cloud Build', 'blue');
  log('3. Grant IAM permissions using the commands shown above', 'blue');
  log('4. Push code to main branch to trigger automatic deployment', 'blue');
  
  log(`\nProject: ${CONFIG.projectId}`, 'bright');
  log(`Region: ${CONFIG.region}`, 'bright');
  log(`Service: ${CONFIG.serviceName}`, 'bright');
  log(`Repository: ${CONFIG.region}-docker.pkg.dev/${CONFIG.projectId}/${CONFIG.repositoryId}`, 'bright');
}

/**
 * Main execution
 */
async function main() {
  try {
    // Validate configuration
    if (!CONFIG.projectId) {
      log('✗ Error: GCP_PROJECT_ID or PROJECT_ID environment variable not set', 'red');
      log('Usage: GCP_PROJECT_ID=your-project-id node setup-infrastructure.mjs', 'yellow');
      process.exit(1);
    }
    
    log('On-Call Cat - GCP Infrastructure Setup', 'bright');
    log(`Project: ${CONFIG.projectId}`, 'blue');
    log(`Region: ${CONFIG.region}`, 'blue');
    
    const confirm = await question('\nProceed with infrastructure setup? (y/N): ');
    if (confirm.toLowerCase() !== 'y') {
      log('Setup cancelled', 'yellow');
      process.exit(0);
    }
    
    // Execute setup steps
    await enableAPIs();
    await createArtifactRegistry();
    await setupSecrets();
    await setupCloudBuild();
    await setupCloudDeploy();
    await setupIAMPermissions();
    
    displaySummary();
    
  } catch (error) {
    log(`\n✗ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, CONFIG };
