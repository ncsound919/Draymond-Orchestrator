module.exports = {
  apps: [{
    name: 'hyp-lifecycle',
    script: 'node_modules/tsx/dist/cli.mjs',
    args: 'scripts/hypothesis-lifecycle.ts',
    cwd: 'C:\\Users\\User\\Downloads\\Uplift\\Draymond-Orchestrator',
    cron_restart: '0 4 * * 1',
    autorestart: false,
    max_restarts: 1
  }]
};
