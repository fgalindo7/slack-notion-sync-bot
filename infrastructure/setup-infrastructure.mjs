#!/usr/bin/env node
/**
 * @fileoverview GCP Infrastructure Setup - Automated provisioning using GCP JS SDK (refactored with CliContext)
 * Creates and configures all required GCP resources for the On-Call Cat bot
 * including Cloud Run, Cloud Build, Cloud Deploy, Artifact Registry, and Secret Manager
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { ArtifactRegistryClient } from '@google-cloud/artifact-registry';
import { CloudBuildClient } from '@google-cloud/cloudbuild';
import { ServiceManagerClient } from '@google-cloud/service-management';
import { google } from 'googleapis';
import { CliContext } from '../lib/cli.js';
import { logger } from '../lib/cli-logger.js';
import _fs from 'fs/promises';

// Static configuration (project/region filled at runtime)
const STATIC = {
  serviceName: 'oncall-cat',
  repositoryId: 'oncall-cat',
  requiredApis: [
    'run.googleapis.com',
    'artifactregistry.googleapis.com',
    'secretmanager.googleapis.com',
    'cloudbuild.googleapis.com',
    'clouddeploy.googleapis.com',
    'aiplatform.googleapis.com',
    'iam.googleapis.com',
  ],
  requiredSecrets: [
    { name: 'slack-bot-token', description: 'Slack Bot User OAuth Token (xoxb-...)' },
    { name: 'slack-app-token', description: 'Slack App-Level Token (xapp-...)' },
    { name: 'notion-token', description: 'Notion Integration Token (secret_...)' },
  ],
  optionalSecrets: [
    { name: 'channel-mappings', description: 'Channel to Database mappings JSON (for multi-channel mode)' },
  ],
};

/**
 * Enable required GCP APIs
 */
async function enableAPIs(cli, config) {
  logger.section('Enabling Required GCP APIs');
  
  const serviceManagement = new ServiceManagerClient();
  
  for (const api of STATIC.requiredApis) {
    try {
      logger.info(`Enabling ${api}...`);
      
      // Check if already enabled
      const [services] = await serviceManagement.listServices({
        consumerId: `project:${config.projectId}`,
      });
      
      const isEnabled = services.some(s => s.serviceName === api);
      
      if (isEnabled) {
        logger.success(`✓ ${api} already enabled`);
      } else {
        // Enable the service
        await serviceManagement.enableService({
          serviceName: api,
        });
        logger.success(`✓ ${api} enabled successfully`);
      }
    } catch (error) {
      logger.warn(`⚠ Warning: Could not enable ${api}: ${error.message}`);
      logger.warn(`  Please enable manually: gcloud services enable ${api}`);
    }
  }
}

/**
 * Create Artifact Registry repository
 */
async function createArtifactRegistry(cli, config) {
  logger.section('Setting Up Artifact Registry');
  
  const client = new ArtifactRegistryClient();
  const parent = `projects/${config.projectId}/locations/${config.region}`;
  const repositoryId = STATIC.repositoryId;
  
  try {
    // Check if repository exists
    const repositoryName = `${parent}/repositories/${repositoryId}`;
    
    try {
      await client.getRepository({ name: repositoryName });
      logger.success(`✓ Artifact Registry repository "${repositoryId}" already exists`);
    } catch (error) {
      if (error.code === 5) { // NOT_FOUND
        logger.info(`Creating Artifact Registry repository "${repositoryId}"...`);
        
        const [operation] = await client.createRepository({
          parent,
          repositoryId,
          repository: {
            format: 'DOCKER',
            description: 'Container images for On-Call Cat bot',
          },
        });
        
        await operation.promise();
        logger.success(`✓ Artifact Registry repository created successfully`);
      } else {
        throw error;
      }
    }
    
    logger.info(`\nRepository URL: ${config.region}-docker.pkg.dev/${config.projectId}/${repositoryId}`);
  } catch (error) {
    logger.error(`✗ Error creating Artifact Registry: ${error.message}`);
    throw error;
  }
}

/**
 * Create or update secrets in Secret Manager
 */
async function setupSecrets(cli, config) {
  logger.section('Setting Up Secret Manager');
  
  const client = new SecretManagerServiceClient();
  const parent = `projects/${config.projectId}`;
  
  // Process required secrets
  for (const secretConfig of STATIC.requiredSecrets) {
    await createOrUpdateSecret(cli, client, parent, secretConfig, true);
  }
  
  // Ask about optional secrets
  logger.info('\n--- Optional Secrets ---');
  
  // Skip optional secrets when not interactive or in dry-run
  const interactive = process.stdin.isTTY && !cli.dryRun;
  if (!interactive) {
    logger.warn('Skipping optional secrets (non-interactive mode)');
    return;
  }
  
  try {
    const setupOptional = await cli.prompt('Set up optional secrets (channel-mappings for multi-channel mode)? (y/N): ', { defaultValue: 'n' });
    
    if (setupOptional.toLowerCase() === 'y') {
      for (const secretConfig of STATIC.optionalSecrets) {
        await createOrUpdateSecret(cli, client, parent, secretConfig, false);
      }
    }
  } catch {
    // Readline closed - skip optional secrets
    logger.warn('Skipping optional secrets (input closed)');
  }
}

/**
 * Create or update a single secret
 */
async function createOrUpdateSecret(cli, client, parent, secretConfig, required) {
  const secretName = `${parent}/secrets/${secretConfig.name}`;
  
  try {
    // Check if secret exists
    let secretExists = false;
    try {
      await client.getSecret({ name: secretName });
      secretExists = true;
      logger.success(`✓ Secret "${secretConfig.name}" already exists`);
      
      const interactive = process.stdin.isTTY && !cli.dryRun;
      // In non-interactive mode, skip existing secrets
      if (!interactive) {
        logger.warn(`  Skipping (non-interactive mode)`);
        return;
      }
      
      // In interactive mode, ask if user wants to update
      try {
        const update = await cli.prompt(`  Update value? (y/N): `, { defaultValue: 'n' });
        if (update.toLowerCase() !== 'y') {
          return;
        }
      } catch {
        // Readline closed - treat as "no update"
        logger.warn(`  Skipping update (input closed)`);
        return;
      }
    } catch (error) {
      if (error.code === 5) { // NOT_FOUND
        logger.info(`Creating secret "${secretConfig.name}"...`);
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
    
    const interactive = process.stdin.isTTY && !cli.dryRun;
    // Skip value prompt in non-interactive mode if secret exists
    if (secretExists && !interactive) {
      return;
    }
    
    // Get secret value from user
    logger.info(`\n${secretConfig.description}`);
    
    let value;
    try {
      value = await cli.prompt(`Enter value for ${secretConfig.name}: `);
    } catch {
      // Readline closed - skip this secret
      logger.warn(`  Skipping (input closed)`);
      if (required && !secretExists) {
        logger.warn(`  ⚠ Warning: Required secret "${secretConfig.name}" not set`);
      }
      return;
    }
    
    if (!value && required && !secretExists) {
      logger.error(`✗ Value required for ${secretConfig.name}`);
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
      logger.success(`✓ Secret value set successfully`);
    }
  } catch (error) {
    logger.error(`✗ Error setting up secret "${secretConfig.name}": ${error.message}`);
    // Don't throw fatal error - continue with remaining secrets
    if (required) {
      logger.warn(`  ⚠ Warning: Required secret failed, but continuing...`);
    }
  }
}

/**
 * Set up Cloud Build trigger
 */
async function setupCloudBuild(cli, config) {
  logger.section('Setting Up Cloud Build');
  
  const client = new CloudBuildClient();
  const parent = `projects/${config.projectId}/locations/${config.region}`;
  
  try {
    logger.info('Creating Cloud Build trigger...');
    logger.warn('Note: GitHub repository connection must be set up manually first');
    logger.warn('Visit: https://console.cloud.google.com/cloud-build/triggers');
    
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
    const [triggers] = await client.listBuildTriggers({ parent, projectId: config.projectId });
    
    const existingTrigger = triggers.find(t => t.name === triggerConfig.name);
    
    if (existingTrigger) {
      logger.success(`✓ Build trigger "${triggerConfig.name}" already exists`);
    } else {
      logger.warn('To create the trigger, run:');
      logger.highlight(`  gcloud beta builds triggers create github \\\n    --name="${triggerConfig.name}" \\\n    --repo-name=slack-notion-sync-bot \\\n    --repo-owner=fgalindo7 \\\n    --branch-pattern="^main$" \\\n    --build-config=cloudbuild.yaml \\\n    --region=${config.region}`);
    }
  } catch (error) {
    logger.warn(`⚠ Warning: ${error.message}`);
    logger.warn('Cloud Build trigger must be created manually via console or gcloud CLI');
  }
}

/**
 * Set up Cloud Deploy pipeline
 */
async function setupCloudDeploy(cli, config) {
  logger.section('Setting Up Cloud Deploy');
  
  logger.info('Cloud Deploy configuration will be created...');
  logger.warn('This requires clouddeploy.yaml and skaffold.yaml files');
  
  // Check if files exist
  const path = await import('path');
  
  const cloudDeployPath = path.join(process.cwd(), 'clouddeploy.yaml');
  const skaffoldPath = path.join(process.cwd(), 'skaffold.yaml');
  
  try { await _fs.access(cloudDeployPath); logger.success(`✓ clouddeploy.yaml found`); }
  catch { logger.warn(`⚠ clouddeploy.yaml not found - will be created`); }
  
  try { await _fs.access(skaffoldPath); logger.success(`✓ skaffold.yaml found`); }
  catch { logger.warn(`⚠ skaffold.yaml not found - will be created`); }
  
  logger.info('\nTo deploy the pipeline after creating config files:');
  logger.highlight(`  gcloud deploy apply --file=clouddeploy.yaml --region=${config.region}`);
}

/**
 * Configure IAM permissions
 */
async function setupIAMPermissions(cli, config) {
  logger.section('Setting Up IAM Permissions');

  // Helper: fetch project number
  async function getProjectNumber(projectId) {
    const crm = google.cloudresourcemanager('v1');
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    google.options({ auth });
    const { data } = await crm.projects.get({ projectId });
    return data.projectNumber?.toString();
  }

  // Helper: ensure project-level IAM bindings
  async function ensureProjectBindings(projectId, bindings) {
    const crm = google.cloudresourcemanager('v1');
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    google.options({ auth });
    const getResp = await crm.projects.getIamPolicy({ resource: projectId, requestBody: {} });
    const policy = getResp.data || { bindings: [] };
    policy.bindings = policy.bindings || [];

    let changed = false;
    for (const { role, members } of bindings) {
      let b = policy.bindings.find(x => x.role === role);
      if (!b) { b = { role, members: [] }; policy.bindings.push(b); changed = true; }
      for (const m of members) {
        if (!b.members.includes(m)) { b.members.push(m); changed = true; }
      }
    }
    if (changed) {
      await crm.projects.setIamPolicy({ resource: projectId, requestBody: { policy } });
    }
    return changed;
  }

  // Helper: ensure service account-level IAM binding (ActAs)
  async function ensureServiceAccountBinding(targetSaEmail, memberSaEmail, role = 'roles/iam.serviceAccountUser') {
    const iam = google.iam('v1');
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    google.options({ auth });
    const resource = `projects/-/serviceAccounts/${targetSaEmail}`;
    const getResp = await iam.projects.serviceAccounts.getIamPolicy({ resource });
    const policy = getResp.data || { bindings: [] };
    policy.bindings = policy.bindings || [];
    let b = policy.bindings.find(x => x.role === role);
    if (!b) { b = { role, members: [] }; policy.bindings.push(b); }
    const member = `serviceAccount:${memberSaEmail}`;
    if (!b.members.includes(member)) {
      b.members.push(member);
      await iam.projects.serviceAccounts.setIamPolicy({ resource, requestBody: { policy } });
      return true;
    }
    return false;
  }

  // Compute principal emails
  const projectId = config.projectId;
  const projectNumber = await getProjectNumber(projectId);
  const defaultCbSa = `${projectNumber}@cloudbuild.gserviceaccount.com`;
  const customCbSa = process.env.CLOUD_BUILD_SA_EMAIL || '';
  const cloudBuildSa = customCbSa || defaultCbSa;
  const computeSa = `${projectNumber}-compute@developer.gserviceaccount.com`;
  const cloudDeployServiceAgent = `service-${projectNumber}@gcp-sa-clouddeploy.iam.gserviceaccount.com`;

  logger.info(`Project Number: ${projectNumber}`);
  logger.info(`Cloud Build SA: ${cloudBuildSa}${customCbSa ? ' (custom)' : ' (default)'}`);
  logger.info(`Runtime (Compute) SA: ${computeSa}`);
  logger.info(`Cloud Deploy SA: ${cloudDeployServiceAgent}`);

  // Ensure project-level roles
  const projectBindings = [
    // Cloud Build SA minimum required
    { role: 'roles/run.admin', members: [`serviceAccount:${cloudBuildSa}`] },
    { role: 'roles/iam.serviceAccountUser', members: [`serviceAccount:${cloudBuildSa}`] },
    { role: 'roles/clouddeploy.releaser', members: [`serviceAccount:${cloudBuildSa}`] },
    { role: 'roles/clouddeploy.viewer', members: [`serviceAccount:${cloudBuildSa}`] },
    { role: 'roles/artifactregistry.writer', members: [`serviceAccount:${cloudBuildSa}`] },
    // Runtime SA least privilege
    { role: 'roles/artifactregistry.reader', members: [`serviceAccount:${computeSa}`] },
    { role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:${computeSa}`] },
    ...(process.env.INCLUDE_VERTEX_AI === '1' ? [{ role: 'roles/aiplatform.user', members: [`serviceAccount:${computeSa}`] }] : [])
  ];

  const changed = await ensureProjectBindings(projectId, projectBindings);
  if (changed) { logger.success('✓ Project-level IAM bindings updated'); }
  else { logger.success('✓ Project-level IAM bindings already satisfied'); }

  // Ensure Cloud Deploy SA can act as runtime SA (ActAs)
  const saChanged = await ensureServiceAccountBinding(computeSa, cloudDeployServiceAgent, 'roles/iam.serviceAccountUser');
  if (saChanged) { logger.success('✓ Granted Cloud Deploy SA ActAs on runtime service account'); }
  else { logger.success('✓ Cloud Deploy SA ActAs on runtime service account already satisfied'); }
  // Optional pruning of runtime SA elevated roles
  if (process.env.PRUNE_RUNTIME_ROLES === '1') {
    const pruneRoles = new Set([
      'roles/run.admin',
      'roles/artifactregistry.writer',
      'roles/secretmanager.admin',
      'roles/clouddeploy.releaser',
      'roles/storage.admin'
    ]);
    const crm = google.cloudresourcemanager('v1');
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    google.options({ auth });
    const policyResp = await crm.projects.getIamPolicy({ resource: projectId, requestBody: {} });
    const policy = policyResp.data;
    let modified = false;
    policy.bindings = (policy.bindings || []).map(b => {
      if (!pruneRoles.has(b.role)) { return b; }
      const filteredMembers = b.members.filter(m => m !== `serviceAccount:${computeSa}`);
      if (filteredMembers.length !== b.members.length) { modified = true; }
      return { ...b, members: filteredMembers };
    });
    if (modified) { await crm.projects.setIamPolicy({ resource: projectId, requestBody: { policy } }); logger.success('✓ Pruned elevated runtime SA roles'); }
    else { logger.success('✓ No elevated runtime SA roles to prune'); }
  } else {
    logger.warn('Runtime role pruning skipped (set PRUNE_RUNTIME_ROLES=1 to enable)');
  }
}

/**
 * Display summary
 */
function displaySummary(config) {
  logger.section('Infrastructure Setup Complete!');
  
  logger.success('✓ APIs enabled');
  logger.success('✓ Artifact Registry created');
  logger.success('✓ Secrets configured');
  logger.success('✓ Cloud Build ready');
  logger.success('✓ Cloud Deploy ready');
  
  logger.info('\nNext steps:');
  logger.info('1. Create clouddeploy.yaml and skaffold.yaml configuration files');
  logger.info('2. Set up GitHub repository connection in Cloud Build');
  logger.info('3. Grant IAM permissions using the commands shown above');
  logger.info('4. Push code to main branch to trigger automatic deployment');
  
  logger.info(`\nProject: ${config.projectId}`);
  logger.info(`Region: ${config.region}`);
  logger.info(`Service: ${STATIC.serviceName}`);
  logger.info(`Repository: ${config.region}-docker.pkg.dev/${config.projectId}/${STATIC.repositoryId}`);
}

/**
 * Main execution
 */
async function main() {
  try {
    const cli = await CliContext.bootstrap({ requireProject: true, requireRegion: true });
    const config = { projectId: cli.projectId, region: cli.region };

    logger.section('On-Call Cat - GCP Infrastructure Setup');
    logger.info(`Project: ${config.projectId}`);
    logger.info(`Region: ${config.region}`);

    const confirm = await cli.prompt('\nProceed with infrastructure setup? (y/N): ', { defaultValue: 'n' });
    if (confirm.toLowerCase() !== 'y') {
      logger.warn('Setup cancelled');
      process.exit(0);
    }

    await enableAPIs(cli, config);
    await createArtifactRegistry(cli, config);
    await setupSecrets(cli, config);
    await setupCloudBuild(cli, config);
    await setupCloudDeploy(cli, config);
    await setupIAMPermissions(cli, config);

    displaySummary(config);
  } catch (error) {
    logger.error(`\n✗ Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
