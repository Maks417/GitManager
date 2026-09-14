// Lints React hook usage with the plugin's recommended rules, including the React Compiler checks: stale
// closures, missing effect dependencies, refs read during render and state set synchronously in effects are
// bugs `tsc` cannot see. Types stay with `npm run typecheck`.
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // A missing dependency is a bug, not a style warning.
      'react-hooks/exhaustive-deps': 'error'
    }
  }
]
