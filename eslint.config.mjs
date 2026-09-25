import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The domain module is pure: no framework, DB or server imports.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: "src/domain must stay framework-free." },
            { name: "react", message: "src/domain must stay framework-free." },
            { name: "zod", message: "src/domain must not depend on zod." },
          ],
          patterns: [
            { group: ["next/*", "react/*", "react-dom", "react-dom/*"], message: "src/domain must stay framework-free." },
            { group: ["@/server", "@/server/*", "**/server/**"], message: "src/domain must not import server code." },
            { group: ["drizzle-orm", "drizzle-orm/*", "postgres"], message: "src/domain must not import DB code." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
