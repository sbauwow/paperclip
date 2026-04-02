/**
 * Lightweight file locking for shared artifact directories.
 *
 * Prevents agent clashes when multiple agents work in the same
 * company artifacts directory. Uses .lock files with agent metadata
 * and automatic expiration.
 *
 * Lock file format: JSON with agentId, agentName, acquiredAt, expiresAt
 * Lock file location: <file>.lock (sibling to the locked file)
 *
 * Usage:
 *   const locks = new FileLockService(instanceRoot);
 *   const result = await locks.acquire("path/to/file.md", agentId, agentName);
 *   if (!result.acquired) console.log(`Locked by ${result.holder}`);
 *   // ... do work ...
 *   await locks.release("path/to/file.md", agentId);
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface LockInfo {
  agentId: string;
  agentName: string;
  acquiredAt: string;
  expiresAt: string;
  filePath: string;
}

export interface AcquireResult {
  acquired: boolean;
  holder?: LockInfo;
}

const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STALE_LOCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes — auto-expire

export class FileLockService {
  constructor(private instanceRoot: string) {}

  private lockPath(filePath: string): string {
    return filePath + ".lock";
  }

  async acquire(
    filePath: string,
    agentId: string,
    agentName: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<AcquireResult> {
    const lockFile = this.lockPath(filePath);

    // Check for existing lock
    const existing = await this.readLock(lockFile);
    if (existing) {
      // Same agent can re-acquire
      if (existing.agentId === agentId) {
        // Extend the lock
        return { acquired: true, holder: await this.writeLock(lockFile, agentId, agentName, filePath, ttlMs) };
      }

      // Check if expired
      const expiresAt = new Date(existing.expiresAt).getTime();
      if (Date.now() < expiresAt) {
        // Lock is held and valid
        return { acquired: false, holder: existing };
      }

      // Lock expired — take over
    }

    const lock = await this.writeLock(lockFile, agentId, agentName, filePath, ttlMs);
    return { acquired: true, holder: lock };
  }

  async release(filePath: string, agentId: string): Promise<boolean> {
    const lockFile = this.lockPath(filePath);
    const existing = await this.readLock(lockFile);

    if (!existing) return true; // Already unlocked
    if (existing.agentId !== agentId) return false; // Not your lock

    try {
      await fs.unlink(lockFile);
      return true;
    } catch {
      return false;
    }
  }

  async forceRelease(filePath: string): Promise<boolean> {
    const lockFile = this.lockPath(filePath);
    try {
      await fs.unlink(lockFile);
      return true;
    } catch {
      return false;
    }
  }

  async status(filePath: string): Promise<LockInfo | null> {
    const lockFile = this.lockPath(filePath);
    const lock = await this.readLock(lockFile);
    if (!lock) return null;

    // Auto-expire stale locks
    const acquiredAt = new Date(lock.acquiredAt).getTime();
    if (Date.now() - acquiredAt > STALE_LOCK_THRESHOLD_MS) {
      await this.forceRelease(filePath);
      return null;
    }

    return lock;
  }

  async listLocks(directory: string): Promise<LockInfo[]> {
    const locks: LockInfo[] = [];
    try {
      const entries = await this.walkForLocks(directory);
      for (const lockFile of entries) {
        const lock = await this.readLock(lockFile);
        if (lock) {
          // Skip stale locks
          const acquiredAt = new Date(lock.acquiredAt).getTime();
          if (Date.now() - acquiredAt > STALE_LOCK_THRESHOLD_MS) {
            await fs.unlink(lockFile).catch(() => {});
            continue;
          }
          locks.push(lock);
        }
      }
    } catch {
      // Directory not readable
    }
    return locks;
  }

  async cleanupExpired(directory: string): Promise<number> {
    let cleaned = 0;
    try {
      const entries = await this.walkForLocks(directory);
      for (const lockFile of entries) {
        const lock = await this.readLock(lockFile);
        if (lock) {
          const expiresAt = new Date(lock.expiresAt).getTime();
          if (Date.now() > expiresAt) {
            await fs.unlink(lockFile).catch(() => {});
            cleaned++;
          }
        }
      }
    } catch {
      // Ignore
    }
    return cleaned;
  }

  private async readLock(lockFile: string): Promise<LockInfo | null> {
    try {
      const content = await fs.readFile(lockFile, "utf-8");
      return JSON.parse(content) as LockInfo;
    } catch {
      return null;
    }
  }

  private async writeLock(
    lockFile: string,
    agentId: string,
    agentName: string,
    filePath: string,
    ttlMs: number,
  ): Promise<LockInfo> {
    const now = new Date();
    const lock: LockInfo = {
      agentId,
      agentName,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      filePath,
    };
    await fs.mkdir(path.dirname(lockFile), { recursive: true });
    await fs.writeFile(lockFile, JSON.stringify(lock, null, 2));
    return lock;
  }

  private async walkForLocks(directory: string): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 5) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full, depth + 1);
          } else if (entry.name.endsWith(".lock")) {
            results.push(full);
          }
        }
      } catch {
        // Skip unreadable dirs
      }
    };
    await walk(directory, 0);
    return results;
  }
}
