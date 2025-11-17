#!/usr/bin/env node
/**
 * @fileoverview Cloud Deploy Automation - Deploy using Cloud Deploy pipeline
 * @author Francisco Galindo
 */

import { CloudDeployClient } from '@google-cloud/deploy';
import { promisify } from 'util';
import { exec } from 'child_process';
import readline from 'readline';

const execAsync = promisify(exec);

// Helper: read gcloud config with env fallback
async function getGcloudConfigValue(key) {
  try {
    const { stdout } = await execAsync(`gcloud config get-value ${key} --quiet 2>/dev/null`);
    const val = stdout.trim();
    if (!val || val === '(unset)') {
      return null;
    }
    return val;
  } catch {
    return null;
  }
}

// Configuration (initialized later in main)
const CONFIG = {
  projectId: null,
  region: null,
  pipelineName: 'oncall-cat-pipeline',
  serviceName: 'oncall-cat',
};

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

// Helper: Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const question = promisify(rl.question).bind(rl);

/**
 * Initialize Cloud Deploy pipeline
 */
async function initializePipeline() {
  logSection('Initializing Cloud Deploy Pipeline');
  
  try {
    log('Replacing project placeholders in configuration files...', 'blue');
    
    // Get project number
    const { stdout: projectNumber } = await execAsync(
      `gcloud projects describe ${CONFIG.projectId} --format='value(projectNumber)'`
    );
    const trimmedProjectNumber = projectNumber.trim();
    
    log(`Project Number: ${trimmedProjectNumber}`, 'blue');
    
    // Replace placeholders in clouddeploy.yaml
    await execAsync(
      `sed -i.bak 's/_PROJECT_ID_/${CONFIG.projectId}/g' clouddeploy.yaml && rm clouddeploy.yaml.bak`
    );
    
    // Replace placeholders in skaffold.yaml
    await execAsync(
      `sed -i.bak 's/_PROJECT_ID_/${CONFIG.projectId}/g' skaffold.yaml && rm skaffold.yaml.bak`
    );
    
    // Replace placeholders in service.yaml
    await execAsync(
      `sed -i.bak 's/_PROJECT_ID_/${CONFIG.projectId}/g' service.yaml && rm service.yaml.bak`
    );
    await execAsync(
      `sed -i.bak 's/_PROJECT_NUMBER_/${trimmedProjectNumber}/g' service.yaml && rm service.yaml.bak`
    );
    
    log('✓ Configuration files updated', 'green');
    
    // Apply Cloud Deploy pipeline
    log('\nApplying Cloud Deploy pipeline...', 'blue');
    const { stdout: applyOutput } = await execAsync(
      `gcloud deploy apply --file=clouddeploy.yaml --region=${CONFIG.region} --project=${CONFIG.projectId}`
    );
    console.log(applyOutput);
    
    log('✓ Pipeline initialized successfully', 'green');
    
  } catch (error) {
    log(`✗ Error initializing pipeline: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Create a new release
 */
async function createRelease() {
  logSection('Creating Cloud Deploy Release');
  
  try {
    // Generate release name with timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    const releaseName = `release-${timestamp}`;
    
    log(`Release name: ${releaseName}`, 'blue');
    log('Building and creating release...', 'blue');
    
    // Set BUILD_TIME environment variable
    const buildTime = new Date().toISOString();
    
    // Create release using gcloud
    const createCmd = `
      BUILD_TIME=${buildTime} gcloud deploy releases create ${releaseName} \
        --delivery-pipeline=${CONFIG.pipelineName} \
        --region=${CONFIG.region} \
        --project=${CONFIG.projectId} \
        --skaffold-file=skaffold.yaml \
        --to-target=staging
    `;
    
    log('Executing:', 'yellow');
    log(createCmd.trim(), 'bright');
    
    const { stdout: releaseOutput } = await execAsync(createCmd);
    console.log(releaseOutput);
    
    log(`✓ Release ${releaseName} created successfully`, 'green');
    
    return releaseName;
    
  } catch (error) {
    log(`✗ Error creating release: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Promote release to production
 */
async function promoteToProduction(releaseName) {
  logSection('Promoting to Production');
  
  const confirm = await question('Promote to production? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    log('Promotion cancelled', 'yellow');
    return;
  }
  
  try {
    log('Promoting release to production...', 'blue');
    
    const promoteCmd = `
      gcloud deploy releases promote \
        --delivery-pipeline=${CONFIG.pipelineName} \
        --region=${CONFIG.region} \
        --project=${CONFIG.projectId} \
        --release=${releaseName}
    `;
    
    const { stdout: promoteOutput } = await execAsync(promoteCmd);
    console.log(promoteOutput);
    
    log('✓ Release promoted to production', 'green');
    
  } catch (error) {
    log(`✗ Error promoting release: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * List recent releases
 */
async function listReleases() {
  logSection('Recent Releases');
  
  try {
    const client = new CloudDeployClient();
    const parent = `projects/${CONFIG.projectId}/locations/${CONFIG.region}/deliveryPipelines/${CONFIG.pipelineName}`;
    
    const [releases] = await client.listReleases({
      parent,
      pageSize: 10,
    });
    
    if (releases.length === 0) {
      log('No releases found', 'yellow');
      return;
    }
    
    log('Recent releases:', 'bright');
    releases.forEach((release, index) => {
      const name = release.name.split('/').pop();
      const createTime = new Date(release.createTime.seconds * 1000).toLocaleString();
      log(`${index + 1}. ${name} - Created: ${createTime}`, 'blue');
    });
    
  } catch (error) {
    log(`⚠ Error listing releases: ${error.message}`, 'yellow');
  }
}

/**
 * Check deployment status
 */
async function checkStatus() {
  logSection('Deployment Status');
  
  try {
    // Check staging
    log('Staging environment:', 'bright');
    const { stdout: stagingStatus } = await execAsync(
      `gcloud run services describe ${CONFIG.serviceName} --region=${CONFIG.region} --project=${CONFIG.projectId} --format='value(status.url,status.latestCreatedRevisionName)'`
    );
    console.log(stagingStatus);
    
    // Check production (if different)
    // This would need to be adapted if you have separate staging/prod services
    
    log('✓ Status check complete', 'green');
    
  } catch (error) {
    log(`⚠ Error checking status: ${error.message}`, 'yellow');
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Resolve project/region from gcloud first, then env, then defaults
    const gcProject = await getGcloudConfigValue('project');
    const gcRunRegion = await getGcloudConfigValue('run/region');
    const gcComputeRegion = await getGcloudConfigValue('compute/region');

    CONFIG.projectId = gcProject || process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || null;
    CONFIG.region = gcRunRegion || gcComputeRegion || process.env.REGION || 'us-central1';

    // Validate configuration
    if (!CONFIG.projectId) {
      log('✗ Error: No GCP project found in gcloud config or environment (GCP_PROJECT_ID/PROJECT_ID)', 'red');
      log('Tip: run `gcloud config set project YOUR_PROJECT_ID` or set env var.', 'yellow');
      process.exit(1);
    }
    
    log('On-Call Cat - Cloud Deploy Automation', 'bright');
    log(`Project: ${CONFIG.projectId}`, 'blue');
    log(`Region: ${CONFIG.region}`, 'blue');
    log(`Pipeline: ${CONFIG.pipelineName}`, 'blue');
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const command = args[0] || 'deploy';
    
    switch (command) {
      case 'init':
        await initializePipeline();
        break;
      
      case 'deploy':
        await listReleases();
        const releaseName = await createRelease();
        await promoteToProduction(releaseName);
        await checkStatus();
        break;
      
      case 'list':
        await listReleases();
        break;
      
      case 'status':
        await checkStatus();
        break;
      
      default:
        log(`Unknown command: ${command}`, 'red');
        log('Available commands: init, deploy, list, status', 'yellow');
        process.exit(1);
    }
    
    log('\n✓ Operation complete', 'green');
    
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
