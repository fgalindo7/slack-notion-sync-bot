/**
 * @fileoverview Git version and status checker
 * @author Francisco Galindo
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

const execAsync = promisify(exec);

/**
 * Git version and status health checker
 */
export class GitCheck extends HealthChecker {
  constructor(config = {}) {
    super('Git', config);
  }

  async check() {
    try {
      const { stdout: sha } = await execAsync('git rev-parse --short HEAD');
      const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD');
      const { stdout: commitTime } = await execAsync('git log -1 --format=%aI');
      const { stdout: status } = await execAsync('git status --porcelain');

      const githubRepo = this.config.githubRepo || 'fgalindo7/slack-notion-sync-bot';
      const shaClean = sha.trim();

      return {
        status: 'ok',
        data: {
          sha: shaClean,
          branch: branch.trim(),
          commitTime: commitTime.trim(),
          hasUncommitted: status.trim().length > 0,
          githubUrl: `https://github.com/${githubRepo}/commit/${shaClean}`,
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

  isApplicable(_target) {
    return true; // Git info applies to all targets
  }

  getIcon() {
    return icons.git;
  }
}

export default GitCheck;
