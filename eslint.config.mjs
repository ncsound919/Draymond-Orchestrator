import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // TS no-unused-vars: treat underscore-prefixed params/vars as intentional
    // (idiomatic placeholder for destructure-strip or reserved-for-future args).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Electron main process is CommonJS — require() is idiomatic there.
    files: ["electron/**/*.{js,mjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Root operational configs + runtime scripts are CommonJS by design
    // (pm2 ecosystems, fleet manifest, diagnostics, data helpers). require()
    // is idiomatic in these — keep the TS-style rule off for them.
    files: [
      "*.{js,cjs,mjs}",
      "data/**/*.{js,cjs,mjs}",
      "hermes-proxy/**/*.{js,cjs,mjs}",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated coverage report.
    "coverage/**",
    // External agent packs — standalone repos, not part of this app.
    "agents/**",
    "public/**",
    "scripts/**",
    // Archived upstream snapshot — reference only, not part of this app.
    "docs/mathx-source-reference/**",
    // Packaged Electron builds — minified/bundled output.
    "release/**",
    // Draymond operational data store — runtime scratch data.
    ".draymond/**",
    ".audit/**",
    // Session scratch helpers (opencode bootstrap, CJS by design).
    "_oc_*.cjs",
  ]),
]);

export default eslintConfig;
