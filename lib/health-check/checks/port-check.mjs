/**
 * @fileoverview Port availability checker
 * @author Francisco Galindo
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

const execAsync = promisify(exec);

/**
 * Port availability health checker
 */
export class PortCheck extends HealthChecker {
  constructor(config = {}) {
    super('Ports', config);
  }

  async check() {
    try {
      const port = this.config.localPort || 1987;
      const { stdout: lsof } = await execAsync(`lsof -i :${port}`);
      const inUse = lsof.trim().length > 0;

      return {
        status: inUse ? 'warn' : 'ok',
        data: {
          port,
          inUse,
        },
        error: null,
      };
    } catch (err) {
      // lsof exits with non-zero if port is not in use, which is actually good
      if (err.code === 1) {
        return {
          status: 'ok',
          data: {
            port: this.config.localPort || 1987,
            inUse: false,
          },
          error: null,
        };
      }
      return {
        status: 'error',
        data: null,
        error: err.message,
      };
    }
  }

  isApplicable(target) {
    return target === 'local'; // Port check only for local
  }

  getIcon() {
    return icons.port;
  }
}

export default PortCheck;
