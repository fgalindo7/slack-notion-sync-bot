#!/usr/bin/env node
/**
 * @fileoverview Cloud Deploy Automation - Deploy using Cloud Deploy pipeline (refactored with CliContext)
 */

import { CloudDeployClient } from '@google-cloud/deploy';
import { CliContext } from '../lib/cli.js';
import { logger } from '../lib/cli-logger.js';
import { parseFlags } from '../lib/cli-flags.js';

/**
 * Initialize Cloud Deploy pipeline
 */
async function initializePipeline(cli, config) {
  logger.section('Initializing Cloud Deploy Pipeline');
  
  try {
    logger.info('Replacing project placeholders in configuration files...');
    
    // Get project number
    const { stdout: projectNumber } = await cli.run(`gcloud projects describe ${config.projectId} --format='value(projectNumber)'`, { capture: true });
    const trimmedProjectNumber = (projectNumber || '').trim();
    
    logger.info(`Project Number: ${trimmedProjectNumber}`);
    
    // Replace placeholders in clouddeploy.yaml
    await cli.run(`sed -i.bak 's/_PROJECT_ID_/${config.projectId}/g' clouddeploy.yaml && rm clouddeploy.yaml.bak`);
    
    // Replace placeholders in skaffold.yaml
    await cli.run(`sed -i.bak 's/_PROJECT_ID_/${config.projectId}/g' skaffold.yaml && rm skaffold.yaml.bak`);
    
    // Replace placeholders in service.yaml
    await cli.run(`sed -i.bak 's/_PROJECT_ID_/${config.projectId}/g' service.yaml && rm service.yaml.bak`);
    await cli.run(`sed -i.bak 's/_PROJECT_NUMBER_/${trimmedProjectNumber}/g' service.yaml && rm service.yaml.bak`);
    
    logger.success('✓ Configuration files updated');
    
    // Apply Cloud Deploy pipeline
    logger.info('Applying Cloud Deploy pipeline...');
    await cli.run(`gcloud deploy apply --file=clouddeploy.yaml --region=${config.region} --project=${config.projectId}`);
    
    logger.success('✓ Pipeline initialized successfully');
    
  } catch (error) {
    logger.error(`✗ Error initializing pipeline: ${error.message}`);
    throw error;
  }
}

/**
 * Create a new release
 */
async function createRelease(cli, config) {
  logger.section('Creating Cloud Deploy Release');
  
  try {
    // Generate release name with timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    const releaseName = `release-${timestamp}`;
    
    logger.info(`Release name: ${releaseName}`);
    logger.info('Building and creating release...');
    
    // Set BUILD_TIME environment variable
    const buildTime = new Date().toISOString();
    
    // Create release using gcloud
    const createCmd = `
      BUILD_TIME=${buildTime} gcloud deploy releases create ${releaseName} \
        --delivery-pipeline=${config.pipelineName} \
        --region=${config.region} \
        --project=${config.projectId} \
        --skaffold-file=skaffold.yaml \
        --to-target=staging
    `;
    
    logger.info('Executing release creation');
    await cli.run(createCmd.trim());
    
    logger.success(`✓ Release ${releaseName} created successfully`);
    
    return releaseName;
    
  } catch (error) {
    logger.error(`✗ Error creating release: ${error.message}`);
    throw error;
  }
}

/**
 * Promote release to production
 */
async function promoteToProduction(cli, config, releaseName) {
  logger.section('Promoting to Production');
  
  const confirm = await cli.prompt('Promote to production? (y/N): ', { defaultValue: 'n' });
  if (confirm.toLowerCase() !== 'y') {
    logger.warn('Promotion cancelled');
    return;
  }
  
  try {
    logger.info('Promoting release to production...');
    
    const promoteCmd = `
      gcloud deploy releases promote \
        --delivery-pipeline=${config.pipelineName} \
        --region=${config.region} \
        --project=${config.projectId} \
        --release=${releaseName}
    `;
    
    await cli.run(promoteCmd.trim());
    
    logger.success('✓ Release promoted to production');
    
  } catch (error) {
    logger.error(`✗ Error promoting release: ${error.message}`);
    throw error;
  }
}

/**
 * List recent releases
 */
async function listReleases(cli, config) {
  logger.section('Recent Releases');
  
  try {
    const client = new CloudDeployClient();
    const parent = `projects/${config.projectId}/locations/${config.region}/deliveryPipelines/${config.pipelineName}`;
    
    const [releases] = await client.listReleases({
      parent,
      pageSize: 10,
    });
    
    if (releases.length === 0) {
      logger.warn('No releases found');
      return;
    }
    
    logger.info('Recent releases:');
    releases.forEach((release, index) => {
      const name = release.name.split('/').pop();
      const createTime = new Date(release.createTime.seconds * 1000).toLocaleString();
      logger.info(`${index + 1}. ${name} - Created: ${createTime}`);
    });
    
  } catch (error) {
    logger.warn(`⚠ Error listing releases: ${error.message}`);
  }
}

/**
 * Check deployment status
 */
async function checkStatus(cli, config) {
  logger.section('Deployment Status');
  
  try {
    // Check staging
    logger.info('Staging environment:');
    const { stdout: stagingStatus } = await cli.run(`gcloud run services describe ${config.serviceName} --region=${config.region} --project=${config.projectId} --format='value(status.url,status.latestCreatedRevisionName)'`, { capture: true });
    if (stagingStatus) {
      process.stdout.write(stagingStatus);
    }
    
    // Check production (if different)
    // This would need to be adapted if you have separate staging/prod services
    
    logger.success('✓ Status check complete');
    
  } catch (error) {
    logger.warn(`⚠ Error checking status: ${error.message}`);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const prelim = parseFlags(process.argv);
    const command = (prelim._raw[0] || 'deploy').toLowerCase();
    const cli = await CliContext.bootstrap({ requireProject: true, requireRegion: true });
    const config = {
      projectId: cli.projectId,
      region: cli.region,
      pipelineName: 'oncall-cat-pipeline',
      serviceName: 'oncall-cat'
    };

    logger.section('On-Call Cat - Cloud Deploy Automation');
    logger.info(`Project: ${config.projectId}`);
    logger.info(`Region: ${config.region}`);
    logger.info(`Pipeline: ${config.pipelineName}`);

    switch (command) {
      case 'init':
        await initializePipeline(cli, config);
        break;
      case 'deploy': {
        await listReleases(cli, config);
        const releaseName = await createRelease(cli, config);
        await promoteToProduction(cli, config, releaseName);
        await checkStatus(cli, config);
        break;
      }
      case 'list':
        await listReleases(cli, config);
        break;
      case 'status':
        await checkStatus(cli, config);
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        logger.warn('Available commands: init, deploy, list, status');
        process.exit(1);
    }

    logger.success('\n✓ Operation complete');
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
