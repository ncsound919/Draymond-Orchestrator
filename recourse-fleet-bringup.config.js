// Recourse fleet-driver bring-up: Codegang (:3204) + Axiom (:3198).
// Recourse's fleetDevelopment.ts drivers probe:
//   codegang -> CODEGANG_URL  http://localhost:3204  health /api
//   axiom    -> AXIOM_URL     http://localhost:3198  health /api/axiom/fleet-bridges
module.exports = {
  apps: [
    {
      name: "codegang",
      script: "node_modules/next/dist/bin/next",
      args: "dev --webpack -p 3204",
      cwd: "C:\\Users\\User\\Downloads\\Uplift\\05_Apps\\Codegang",
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      env: { NODE_ENV: "development", PORT: "3204" },
    },
    {
      name: "axiom",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "server.ts",
      cwd: "C:\\Users\\User\\Downloads\\Uplift\\Deepseek Harness\\Axiom Agent",
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      autorestart: true,
      max_memory_restart: "1G",
      restart_delay: 3000,
      env: { AXIOM_PORT: "3198", NODE_ENV: "production" },
    },
  ],
};
