// Parse common CLI flags into a structured object
export function parseFlags(argv) {
  const [, , ...rest] = argv;
  const flags = { _raw: rest };
  for (const arg of rest) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const [k, v] = arg.replace(/^--/, '').split('=');
    flags[k] = v === undefined ? true : v;
  }
  // Normalized names
  flags.projectFlag = flags.project || null;
  flags.regionFlag = flags.region || null;
  flags.target = (flags.target || 'gcp').toLowerCase();
  flags.dryRun = Boolean(flags['dry-run'] || flags.dryRun || process.env.DRY_RUN === '1');
  return flags;
}
