import { globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
export default [globalIgnores([".next/**", "node_modules/**", "presentation/**", "test-results/**", "playwright-report/**"]), { plugins: { "@next/next": nextPlugin }, rules: nextPlugin.configs.recommended.rules }];
