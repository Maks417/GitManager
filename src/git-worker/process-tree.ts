import { spawn, type ChildProcess } from 'child_process'

/** Spawn options that let `killProcessTree` stop a child together with the processes it starts. */
export function treeSpawnOptions(): { detached: boolean } {
  // On macOS and Linux the child leads a new process group that can be signalled as a whole. The group
  // has no controlling terminal either, so ssh cannot hang on a prompt that nobody can see.
  return { detached: process.platform !== 'win32' }
}

/**
 * Stop `child` and everything it started: git → git-remote-https → credential manager, or git → ssh.
 * `child.kill()` alone leaves the helpers running and holding the connection open.
 */
export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('error', () => child.kill())
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* the group is already gone */
    }
  }, 3000).unref()
}
