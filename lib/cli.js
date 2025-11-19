// Higher-level CLI context class integrating flags, GCP resolution, logging, and exec
import readline from 'readline';
import { promisify } from 'util';
import { parseFlags } from './cli-flags.js';
import { resolveGcpContext } from './gcp-context.js';
import { logger } from './cli-logger.js';
import { run } from './cli-exec.js';

export class CliContext {
  constructor({ argv, requireProject = true, requireRegion = true } = {}) {
    this.argv = argv || process.argv;
    this.flags = parseFlags(this.argv);
    this.requireProject = requireProject;
    this.requireRegion = requireRegion;
    this.projectId = null;
    this.region = null;
    this.dryRun = Boolean(this.flags.dryRun);
    this.executed = []; // record commands for test assertions
    this._rl = null;
  }

  async init() {
    const ctx = await resolveGcpContext({
      projectFlag: this.flags.projectFlag,
      regionFlag: this.flags.regionFlag,
      requireRegion: this.requireRegion && this.flags.target === 'gcp'
    }).catch(err => {
      if (this.flags.target === 'local' && !this.requireProject) {
        return { projectId: null, region: null };
      }
      throw err;
    });
    this.projectId = ctx.projectId;
    this.region = ctx.region;
    return this;
  }

  async run(cmd, opts = {}) {
    const res = await run(cmd, { dryRun: this.dryRun, ...opts });
    this.executed.push(res.command);
    return res;
  }

  section(title) { logger.section(title); }
  info(msg) { logger.info(msg); }
  warn(msg) { logger.warn(msg); }
  error(msg) { logger.error(msg); }
  success(msg) { logger.success(msg); }
  highlight(msg) { logger.highlight(msg); }

  async prompt(question, { defaultValue = '' } = {}) {
    if (this.dryRun || !process.stdin.isTTY) {
      this.info(`[dry-run] prompt skipped: ${question}`);
      return defaultValue;
    }
    if (!this._rl) {
      this._rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    const ask = promisify(this._rl.question).bind(this._rl);
    try {
      const ans = await ask(question);
      return ans || defaultValue;
    } catch {
      return defaultValue;
    }
  }

  close() {
    if (this._rl) {
      this._rl.close();
    }
  }

  ensure(vars) {
    const missing = vars.filter(v => !this[v]);
    if (missing.length) {
      throw new Error(`Missing required context vars: ${missing.join(', ')}`);
    }
  }

  static async bootstrap(opts) {
    const cli = new CliContext(opts);
    await cli.init();
    return cli;
  }
}
