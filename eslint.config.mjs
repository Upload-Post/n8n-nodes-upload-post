import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        files: ["**/*.ts"],
        rules: {
            "no-unused-vars": "warn"
        }
    }
];
