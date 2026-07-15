import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  { ignores: ['**/dist/'] },
  eslintConfigPrettier,
  {
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'warn',
    },
  },
];
