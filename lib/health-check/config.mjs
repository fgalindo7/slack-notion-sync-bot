/**
 * @fileoverview Shared configuration for health check scripts
 * @author Francisco Galindo
 */

export const CONFIG = {
  serviceName: 'oncall-cat',
  pipelineName: 'oncall-cat-pipeline',
  refreshInterval: 30000, // 30 seconds default
  maxWidth: 78, // Terminal standard width (80 - 2 for margins)
  minWidth: 60,
  githubRepo: 'fgalindo7/slack-notion-sync-bot',
  localPort: 1987,
};

export default CONFIG;
