/**
 * @fileoverview Default configuration values for infrastructure
 */

export const DEFAULTS = {
  // Service configuration
  serviceName: 'oncall-cat',
  repoName: 'oncall-cat',
  pipelineName: 'oncall-cat-pipeline',

  // Build configuration
  machineType: 'E2_HIGHCPU_8',
  buildTimeoutSeconds: 600,
  dockerImageTags: ['latest'],

  // Deployment configuration
  region: 'us-central1',
  minInstances: 1,
  maxInstances: 3,
  memory: '512Mi',
  cpu: 1,

  // API configuration
  apiEnableTimeoutMs: 60000,

  // Valid GCP regions
  validRegions: [
    'us-central1',
    'us-east1',
    'us-east4',
    'us-west1',
    'us-west2',
    'us-west3',
    'us-west4',
    'europe-west1',
    'europe-west2',
    'europe-west3',
    'europe-west4',
    'europe-north1',
    'asia-east1',
    'asia-east2',
    'asia-northeast1',
    'asia-northeast2',
    'asia-northeast3',
    'asia-south1',
    'asia-southeast1',
    'asia-southeast2',
    'australia-southeast1',
  ],
};

export default DEFAULTS;
