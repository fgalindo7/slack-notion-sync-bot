/**
 * @fileoverview JSON renderer for health check results
 * @author Francisco Galindo
 */

import { Renderer } from '../renderer.mjs';

/**
 * JSON renderer - outputs raw JSON data
 */
export class JsonRenderer extends Renderer {
  constructor(config = {}, flags = {}) {
    super(config, flags);
  }

  async render(results) {
    // Convert results array to structured JSON matching original format
    const output = {};

    for (const result of results) {
      const key = this.getKeyForChecker(result.checker);
      if (key) {
        if (key === 'health') {
          // Special case for health - preserve original structure
          output[key] = result.data ? { ok: result.status === 'ok', json: result.data.health } : { ok: false, error: result.error };
        } else if (result.checker === 'GCP Services') {
          // Flatten GCP services
          if (result.data) {
            output.cloudRun = result.data.cloudRun;
            output.cloudDeploy = result.data.cloudDeploy;
            output.cloudBuild = result.data.cloudBuild;
          }
        } else {
          output[key] = result.data;
        }
      }
    }

    // Ensure mappings are included from health data
    const healthResult = results.find(r => r.checker === 'Application Health');
    if (healthResult?.data?.mappings) {
      output.mappings = healthResult.data.mappings;
    } else {
      output.mappings = { databases: [] };
    }

    console.log(JSON.stringify(output, null, 2));
  }

  getKeyForChecker(checkerName) {
    const mapping = {
      'Application Health': 'health',
      'Git': 'git',
      'GCP Services': 'gcp',
      'Docker': 'docker',
      'Node.js': 'node',
      'Filesystem': 'filesystem',
      'Ports': 'ports',
    };
    return mapping[checkerName];
  }

  clear() {
    // No-op for JSON output
  }
}

export default JsonRenderer;
