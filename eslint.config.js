import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Flat config covering all three TypeScript surfaces in the repo: the React
 * frontend (src/), the Vercel serverless functions (api/) and the QuickBooks
 * Desktop bridge (bridge/src/). They run in different environments, so the
 * globals differ per block.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "bridge/dist/**", "node_modules/**", "bridge/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Frontend — browser globals plus the React Hooks rules, which catch the
    // dependency-array mistakes that cause stale reads in the job sheet forms.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // Serverless functions and the bridge both run on Node.
    files: ["api/**/*.ts", "bridge/**/*.{ts,mjs,js}", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    // An unused parameter named with a leading underscore is a deliberate
    // signal that a handler signature is being honoured, not an oversight —
    // several Vercel/Express handlers ignore `req`.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
