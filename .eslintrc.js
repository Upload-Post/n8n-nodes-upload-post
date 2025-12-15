module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    env: {
        node: true,
        es6: true
    },
    ignorePatterns: ["node_modules/", "dist/"],
    overrides: [
        {
            files: ['*.ts', '*.tsx'],
            rules: {
                '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
                'no-unused-vars': 'off', // handled by typescript-eslint
                'no-mixed-spaces-and-tabs': 'off', // Turn off for now to avoid noise
                'no-constant-condition': ['error', { checkLoops: false }], // Allow while(true)
                '@typescript-eslint/no-explicit-any': 'off', // Allow any
                'prefer-const': 'off',
            }
        }
    ]
};
