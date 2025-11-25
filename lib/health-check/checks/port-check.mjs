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
      let inUse = false;
      let processInfo = null;
      let serviceName = null;

      try {
        const { stdout: lsof } = await execAsync(`lsof -i :${port} -sTCP:LISTEN | tail -n +2`);
        inUse = lsof.trim().length > 0;
        if (inUse) {
          // Extract process info (command name from first column)
          const lines = lsof.trim().split('\n');
          if (lines.length > 0) {
            const parts = lines[0].trim().split(/\s+/);
            processInfo = parts[0]; // First column is the command

            // Try to get more specific info from docker
            if (processInfo.toLowerCase().includes('docker') || processInfo.toLowerCase().includes('com.docke')) {
              try {
                // Try to find container by published port
                const { stdout: dockerPs } = await execAsync(`docker ps --format "{{.Names}}" --filter "publish=${port}" 2>/dev/null || echo ""`);
                let containerName = dockerPs.trim();

                // If filter by publish doesn't work, try to find any oncall container
                if (!containerName) {
                  const { stdout: dockerAll } = await execAsync(`docker ps --format "{{.Names}}" --filter "name=oncall" 2>/dev/null || echo ""`);
                  containerName = dockerAll.trim().split('\n')[0];
                }

                if (containerName) {
                  serviceName = containerName;
                }
              } catch (dockerErr) {
                // Docker command failed, stick with processInfo
              }
            }
          }
        }
      } catch (lsofErr) {
        // lsof exits with non-zero if port is not in use
        if (lsofErr.code === 1) {
          inUse = false;
        } else {
          throw lsofErr;
        }
      }

      // For local health checks, we WANT the port to be in use by our service
      // Only warn if port is in use by something unexpected
      const isOncallCat = processInfo && (
        processInfo.toLowerCase().includes('node') ||
        processInfo.toLowerCase().includes('docker') ||
        (serviceName && serviceName.toLowerCase().includes('oncall'))
      );

      return {
        status: 'ok',
        data: {
          port,
          inUse,
          processInfo,
          serviceName,
          isExpected: isOncallCat,
        },
        error: null,
      };
    } catch (err) {
      return {
        status: 'error',
        data: {
          port: this.config.localPort || 1987,
        },
        error: err.message,
      };
    }
  }

  isApplicable(target) {
    return target === 'local'; // Port check only for local
  }

  getIcon() {
    return icons.emojiPort;
  }
}

export default PortCheck;
