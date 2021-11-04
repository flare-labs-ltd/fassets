module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    plugins: [
        "@typescript-eslint"
    ],
    extends: [
    ],
    rules: {
        // 'no-var': 'warn',
        'guard-for-in': 'warn',
        // 'eqeqeq': ['warn', 'always', { null: 'ignore' }],
        '@typescript-eslint/await-thenable': 'warn',
        '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
    parserOptions: {
        ecmaVersion: 2020,
        project: './tsconfig.json',
    },
}
