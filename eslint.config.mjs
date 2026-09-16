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
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      // The package entry adds Monaco's language services, whose workers a diff would start.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'monaco-editor',
              message: 'Import Monaco from lib/monaco-api: this entry also loads its TypeScript, CSS, HTML and JSON language services.'
            }
          ]
        }
      ]
    }
  }
]
