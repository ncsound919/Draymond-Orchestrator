// ============================================================================
// PM2 — DeepSeek Harness (ecosystem-aware, Ox Alpha free primary)
// ============================================================================
// DeepSeek Harness as the ecosystem LLM router: Ox Alpha free (zen/v1)
// → DeepSeek direct fallback. Overlay: C:/Users/User/Downloads/Deepseek Harness/ecosystem.patch.yml
//
//   npx pm2 start ecosystem.dsh.config.js && npx pm2 save
//   pm2 logs dsh-harness
//
// Keys from Draymond's .env.local; workspace pinned to UPLIFT_ROOT.
// ============================================================================

const { DSH_SERVICES } = require("./fleet-manifest");

module.exports = {
  apps: DSH_SERVICES,
};
