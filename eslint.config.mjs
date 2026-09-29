// Repository-wide lint. Deliberately bug-focused rather than stylistic:
// formatting is left to each file's existing conventions.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      'playwright-report/**',
      'test-results/**',
      'mobile/android/**',
      'mobile/ios/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Leading underscores mark deliberately unused values, and rest
      // siblings are the idiom for dropping fields from an object.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    files: ['shared/**/*.ts', 'backend/**/*.ts', 'scripts/**/*.{js,mjs}', '*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // React Native bundles static images through require().
    files: ['mobile/src/routes/routeCardAssets.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // CommonJS config and Expo config plugins.
    files: ['mobile/**/*.{js,cjs}'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['mobile/tests-jest/**', 'mobile/jest.setup.cjs'],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    files: ['docs/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      // `google` is the Maps JavaScript API loaded at runtime.
      globals: { ...globals.browser, ...globals.serviceworker, google: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.js', 'playwright.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
