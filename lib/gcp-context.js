// Unified GCP context resolution
// Precedence: explicit flags > gcloud config > environment vars > default/throw
// Provides resolveGcpContext() and getConfigValue()
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function getConfigValue(key) {
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

function remediationCommands() {
  return {
    setProject: 'gcloud config set project <PROJECT_ID>',
    setRunRegion: 'gcloud config set run/region us-central1',
    setComputeRegion: 'gcloud config set compute/region us-central1'
  };
}

export async function resolveGcpContext({ projectFlag, regionFlag, requireRegion = true, allowGcloud = true } = {}) {
  const cmds = remediationCommands();
  const envProject = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || null;
  const envRegion = process.env.REGION || null;

  let gcProject = null;
  let gcRunRegion = null;
  let gcComputeRegion = null;
  if (allowGcloud) {
    gcProject = await getConfigValue('project');
    gcRunRegion = await getConfigValue('run/region');
    gcComputeRegion = await getConfigValue('compute/region');
  }

  const projectId = projectFlag || gcProject || envProject;
  const region = regionFlag || gcRunRegion || gcComputeRegion || envRegion || (requireRegion ? 'us-central1' : null);

  const errors = [];
  if (!projectId) {
    errors.push(`Missing GCP project. Set via: ${cmds.setProject} or export GCP_PROJECT_ID`);
  }
  if (requireRegion && !region) {
    errors.push(`Missing region. Set via: ${cmds.setRunRegion}`);
  }
  if (errors.length) {
    const message = errors.join('\n');
    const err = new Error(message);
    err.code = 'GCP_CONTEXT_ERROR';
    throw err;
  }
  return { projectId, region };
}

export { getConfigValue };