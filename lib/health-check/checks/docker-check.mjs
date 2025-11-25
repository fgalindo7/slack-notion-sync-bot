/**
 * @fileoverview Docker environment checker
 * @author Francisco Galindo
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

const execAsync = promisify(exec);

/**
 * Docker environment health checker
 */
export class DockerCheck extends HealthChecker {
  constructor(config = {}) {
    super('Docker', config);
  }

  async check() {
    try {
      const { stdout: info } = await execAsync('docker info --format "{{.ServerVersion}}"');
      const version = info.trim();

      const { stdout: ps } = await execAsync('docker ps --format "table {{.Names}}\t{{.Status}}"');
      const containers = ps.trim();

      const { stdout: images } = await execAsync('docker images --format "{{.Repository}}:{{.Tag}}" | grep oncall-cat || true');
      const hasImage = images.trim().length > 0;

      return {
        status: 'ok',
        data: {
          version,
          containers,
          hasImage,
        },
        error: null,
      };
    } catch (err) {
      return {
        status: 'error',
        data: null,
        error: err.message,
      };
    }
  }

  isApplicable(target) {
    return target === 'local'; // Docker check only for local
  }

  getIcon() {
    return icons.emojiWhale;
  }
}

export default DockerCheck;
