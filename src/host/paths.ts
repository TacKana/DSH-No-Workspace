import { mkdir, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Folder name prefix shared with the client's identity check. */
export const DIRECTORY_PREFIX = 'dsh-chat-'

/** One allocated conversation directory. */
export interface Allocation {
  sessionId: string
  cwd: string
}

/** Private permissions for everything this plugin creates. */
const DIRECTORY_MODE = 0o700

/**
 * Resolve the configured conversation root.
 *
 * An explicitly configured absolute path wins. Otherwise the directory sits
 * inside the launched profile, which the launcher publishes as
 * `ctx.profileContext` (with `DSH_PROFILE_DIR` as the fallback for contexts
 * that do not expose it).
 * @param configured - value of the `root` loader-row option.
 * @param profileDir - profile directory, when the launcher provides one.
 * @returns an absolute directory, or `undefined` when none can be determined.
 */
export function resolveRoot(configured: string, profileDir: string | undefined): string | undefined {
  const candidate = configured.length > 0
    ? configured
    : profileDir === undefined || profileDir.length === 0
      ? ''
      : path.join(profileDir, 'session-workspaces')
  if (candidate.length === 0 || !path.isAbsolute(candidate)) return undefined
  // `\foo`/`/foo` are drive-relative on Windows: they look absolute to node:path
  // but resolve against the current drive, so the folder would land elsewhere.
  if (process.platform === 'win32' && /^[\\/](?![\\/])/.test(candidate)) return undefined
  return candidate
}

/**
 * Allocate one directory name. The SessionId is chosen here and the folder is
 * named after it, so the client can recognise its own conversations from the
 * persisted `cwd` alone — no side-channel metadata, and it survives a refresh
 * or a different device.
 * @param root - absolute conversation root.
 * @returns the pre-allocated SessionId and its directory.
 */
export function allocate(root: string): Allocation {
  const sessionId = randomUUID()
  return { sessionId, cwd: path.join(root, `${DIRECTORY_PREFIX}${sessionId}`) }
}

/**
 * Create the root and the new conversation directory.
 * The leaf `mkdir` is deliberately non-recursive: an existing directory with
 * the same name means the allocation collided and must not be reused.
 * @param allocation - directory to create.
 * @param root - absolute conversation root.
 */
export async function createDirectory(allocation: Allocation, root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: DIRECTORY_MODE })
  await mkdir(allocation.cwd, { mode: DIRECTORY_MODE })
}

/**
 * Remove a directory that this request created and then failed to bind.
 * `rmdir` only succeeds on an empty directory, so nothing a user or the agent
 * wrote can be lost here.
 * @param cwd - directory to remove.
 * @param warn - logger used when the directory is not empty.
 */
export async function discardDirectory(cwd: string, warn: (message: string, ...args: unknown[]) => void): Promise<void> {
  try {
    await rmdir(cwd)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn('保留未能清理的会话目录', cwd, error instanceof Error ? error.message : String(error))
    }
  }
}
