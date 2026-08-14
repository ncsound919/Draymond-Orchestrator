module.exports = {
  apps: [
    {
      name: 'next-build',
      script: 'C:/Program Files/nodejs/node.exe',
      args: 'node_modules/next/dist/bin/next build',
      cwd: 'C:/Users/User/Downloads/Uplift/Draymond-Orchestrator',
      autorestart: false,
      windowsHide: true,
      out_file: 'C:/Users/User/Downloads/Uplift/Draymond-Orchestrator/data/next-build.log',
      error_file: 'C:/Users/User/Downloads/Uplift/Draymond-Orchestrator/data/next-build.err.log',
      max_restarts: 1,
    },
  ],
};
