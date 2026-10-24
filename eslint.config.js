import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const frameworkPackages = [
  'drizzle-orm',
  'drizzle-orm/*',
  'postgres',
  'fastify',
  'fastify-*',
  '@fastify/*',
  'ioredis',
  'bullmq',
  'arctic',
];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/api/drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Clean architecture: dependencies point inward (http -> application -> domain).
  {
    files: ['apps/api/src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/application/**', '**/infrastructure/**', '**/http/**', '**/container*'],
              message: 'Domain code must not depend on outer layers.',
            },
            {
              group: frameworkPackages,
              message: 'Domain code must not depend on frameworks or drivers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**', '**/http/**', '**/container*'],
              message: 'Use cases depend on ports (interfaces), not on implementations.',
            },
            {
              group: frameworkPackages,
              message: 'Use cases must not depend on frameworks or drivers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
