import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "packages/database/src/generated/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
);
