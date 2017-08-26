module.exports = {
  parserOptions: {
    ecmaVersion: 8
  },
  env: {
    es6: true,
    node: true
  },
  extends: 'eslint:recommended',
  rules: {
    indent: ['error', 2],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single'],
    semi: ['error', 'always']
  }
};
