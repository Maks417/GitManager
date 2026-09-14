import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Tests must not depend on the developer's git config (default branch, signing, hooks, autocrlf).
const configDir = mkdtempSync(join(tmpdir(), 'gm-gitconfig-'))
const globalConfig = join(configDir, 'gitconfig')
writeFileSync(globalConfig, '')
process.env.GIT_CONFIG_GLOBAL = globalConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'
// Temp folders must never be discovered as part of an enclosing repository (e.g. a dotfiles home).
process.env.GIT_CEILING_DIRECTORIES = tmpdir()
