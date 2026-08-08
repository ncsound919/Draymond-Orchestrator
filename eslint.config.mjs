import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Electron main process is CommonJS — require() is idiomatic there.
    files: ["electron/**/*.{js,mjs}"],
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
  ]),
]);

export default eslintConfig;
