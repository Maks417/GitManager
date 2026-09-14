/**
 * Folder name for a clone, as Git would choose it: `…/repo.git/` → `repo`,
 * `git@host:team/repo.git` → `repo`, `C:\src\project` → `project`.
 */
export function repoNameFromUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\.git$/i, '')
    .replace(/[\\/]+$/, '')
  const last = trimmed.split(/[\\/:]/).filter(Boolean).pop() ?? ''
  // Characters Windows forbids in folder names; a name of only dots is not a folder name.
  const safe = last.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '')
  return safe || 'repo'
}
