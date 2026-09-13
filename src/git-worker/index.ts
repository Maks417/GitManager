/**
 * Git operations entry. Invoked from Electron main (and optionally utilityProcess).
 * Kept as a module so parsers/tests can import without Electron.
 */
export * from './git-runner'
export * from './operations'
