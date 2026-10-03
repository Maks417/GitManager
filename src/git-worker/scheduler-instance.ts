import { createRepoScheduler } from './repo-scheduler'
import { getGitDirs } from './ops/shared'

/** Shared by the utility process and the main-process inline fallback. */
export const gitRepoScheduler = createRepoScheduler({
  resolveCommonDir: async (repoPath) => (await getGitDirs(repoPath)).commonDir
})
