/**
 * Git operations entry. Invoked from Electron main via {@link ./client} (utilityProcess
 * on Windows and macOS, with in-process fallback). Kept as a module so parsers/tests
 * can import without Electron.
 */
export * from './git-runner'
export * from './operations'
