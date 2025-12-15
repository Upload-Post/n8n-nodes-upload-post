import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";

export default [
    js.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json"
            }
        },
        rules: {
            "no-unused-vars": "off",
            "no-undef": "off"
        }
    }
];
