import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { FileLockService } from "../services/file-locks.js";

const ALLOWED_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml",
  ".csv", ".xml", ".html", ".css", ".py", ".ts", ".js",
  ".sh", ".bash", ".log", ".cfg", ".ini", ".conf",
]);

const MAX_FILE_SIZE = 512 * 1024; // 512 KB

function isAllowedFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

async function walkDir(
  dir: string,
  baseDir: string,
  maxDepth: number = 5,
  depth: number = 0,
): Promise<Array<{ path: string; name: string; type: "file" | "directory"; size: number; modified: string }>> {
  if (depth > maxDepth) return [];

  const entries: Array<{ path: string; name: string; type: "file" | "directory"; size: number; modified: string }> = [];

  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith(".") || item.name === "node_modules") continue;

      const fullPath = path.join(dir, item.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (item.isDirectory()) {
        entries.push({
          path: relativePath,
          name: item.name,
          type: "directory",
          size: 0,
          modified: "",
        });
        const children = await walkDir(fullPath, baseDir, maxDepth, depth + 1);
        entries.push(...children);
      } else if (item.isFile() && isAllowedFile(item.name)) {
        try {
          const stat = await fs.stat(fullPath);
          entries.push({
            path: relativePath,
            name: item.name,
            type: "file",
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory not readable
  }

  return entries;
}

export function artifactRoutes(db: Db) {
  const instanceRoot = resolvePaperclipInstanceRoot();
  const router = Router();

  // GET /artifacts/agents/:agentId/tree — list all files in agent's workspace
  router.get("/artifacts/agents/:agentId/tree", async (req, res) => {
    try {
      const { agentId } = req.params;
      const agent = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).then((r) => r[0]);
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const agentDir = path.join(
        instanceRoot,
        "companies",
        agent.companyId,
        "agents",
        agentId,
      );

      const files = await walkDir(agentDir, agentDir);
      res.json({ agentId, root: agentDir, files });
    } catch (err) {
      res.status(500).json({ error: "Failed to list artifacts" });
    }
  });

  // GET /artifacts/agents/:agentId/file?path=... — read a specific file
  router.get("/artifacts/agents/:agentId/file", async (req, res) => {
    try {
      const { agentId } = req.params;
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: "path query parameter required" });

      const agent = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).then((r) => r[0]);
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const agentDir = path.join(
        instanceRoot,
        "companies",
        agent.companyId,
        "agents",
        agentId,
      );

      const fullPath = path.resolve(agentDir, filePath);
      // Security: ensure the resolved path is within the agent directory
      if (!fullPath.startsWith(agentDir)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }

      if (!isAllowedFile(fullPath)) {
        return res.status(400).json({ error: "File type not allowed" });
      }

      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        return res.status(413).json({ error: "File too large", size: stat.size, maxSize: MAX_FILE_SIZE });
      }

      const content = await fs.readFile(fullPath, "utf-8");
      res.json({
        path: filePath,
        name: path.basename(fullPath),
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch (err: any) {
      if (err.code === "ENOENT") return res.status(404).json({ error: "File not found" });
      res.status(500).json({ error: "Failed to read file" });
    }
  });

  // GET /artifacts/companies/:companyId/tree — list company-level artifacts
  router.get("/artifacts/companies/:companyId/tree", async (req, res) => {
    try {
      const { companyId } = req.params;
      const companyDir = path.join(instanceRoot, "companies", companyId, "artifacts");

      try {
        await fs.access(companyDir);
      } catch {
        // Create artifacts dir if it doesn't exist
        await fs.mkdir(companyDir, { recursive: true });
      }

      const files = await walkDir(companyDir, companyDir);
      res.json({ companyId, root: companyDir, files });
    } catch {
      res.status(500).json({ error: "Failed to list company artifacts" });
    }
  });

  // GET /artifacts/companies/:companyId/file?path=... — read company artifact
  router.get("/artifacts/companies/:companyId/file", async (req, res) => {
    try {
      const { companyId } = req.params;
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: "path query parameter required" });

      const companyDir = path.join(instanceRoot, "companies", companyId, "artifacts");
      const fullPath = path.resolve(companyDir, filePath);

      if (!fullPath.startsWith(companyDir)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }

      if (!isAllowedFile(fullPath)) {
        return res.status(400).json({ error: "File type not allowed" });
      }

      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        return res.status(413).json({ error: "File too large" });
      }

      const content = await fs.readFile(fullPath, "utf-8");
      res.json({
        path: filePath,
        name: path.basename(fullPath),
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch (err: any) {
      if (err.code === "ENOENT") return res.status(404).json({ error: "File not found" });
      res.status(500).json({ error: "Failed to read file" });
    }
  });

  // GET /artifacts/workspaces/:workspaceId/tree — list workspace files
  router.get("/artifacts/workspaces/:workspaceId/tree", async (req, res) => {
    try {
      const { workspaceId } = req.params;
      const wsDir = path.join(instanceRoot, "workspaces", workspaceId);

      try {
        await fs.access(wsDir);
      } catch {
        return res.status(404).json({ error: "Workspace not found" });
      }

      const files = await walkDir(wsDir, wsDir);
      res.json({ workspaceId, root: wsDir, files });
    } catch {
      res.status(500).json({ error: "Failed to list workspace artifacts" });
    }
  });

  // GET /artifacts/workspaces/:workspaceId/file?path=... — read workspace file
  router.get("/artifacts/workspaces/:workspaceId/file", async (req, res) => {
    try {
      const { workspaceId } = req.params;
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: "path query parameter required" });

      const wsDir = path.join(instanceRoot, "workspaces", workspaceId);
      const fullPath = path.resolve(wsDir, filePath);

      if (!fullPath.startsWith(wsDir)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }

      if (!isAllowedFile(fullPath)) {
        return res.status(400).json({ error: "File type not allowed" });
      }

      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        return res.status(413).json({ error: "File too large" });
      }

      const content = await fs.readFile(fullPath, "utf-8");
      res.json({
        path: filePath,
        name: path.basename(fullPath),
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch (err: any) {
      if (err.code === "ENOENT") return res.status(404).json({ error: "File not found" });
      res.status(500).json({ error: "Failed to read file" });
    }
  });

  // ── File Locking ──────────────────────────────────────────────────

  const lockService = new FileLockService(instanceRoot);

  // POST /artifacts/locks/acquire — acquire a file lock
  router.post("/artifacts/locks/acquire", async (req, res) => {
    try {
      const { filePath, agentId, agentName, ttlMs } = req.body;
      if (!filePath || !agentId) {
        return res.status(400).json({ error: "filePath and agentId required" });
      }
      const fullPath = path.resolve(instanceRoot, filePath);
      if (!fullPath.startsWith(instanceRoot)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }
      const result = await lockService.acquire(fullPath, agentId, agentName || agentId, ttlMs);
      res.json(result);
    } catch {
      res.status(500).json({ error: "Failed to acquire lock" });
    }
  });

  // POST /artifacts/locks/release — release a file lock
  router.post("/artifacts/locks/release", async (req, res) => {
    try {
      const { filePath, agentId } = req.body;
      if (!filePath || !agentId) {
        return res.status(400).json({ error: "filePath and agentId required" });
      }
      const fullPath = path.resolve(instanceRoot, filePath);
      if (!fullPath.startsWith(instanceRoot)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }
      const released = await lockService.release(fullPath, agentId);
      res.json({ released });
    } catch {
      res.status(500).json({ error: "Failed to release lock" });
    }
  });

  // GET /artifacts/locks/status?path=... — check lock status
  router.get("/artifacts/locks/status", async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: "path required" });
      const fullPath = path.resolve(instanceRoot, filePath);
      if (!fullPath.startsWith(instanceRoot)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }
      const lock = await lockService.status(fullPath);
      res.json({ locked: !!lock, lock });
    } catch {
      res.status(500).json({ error: "Failed to check lock" });
    }
  });

  // GET /artifacts/locks/list?dir=... — list all active locks in a directory
  router.get("/artifacts/locks/list", async (req, res) => {
    try {
      const dir = (req.query.dir as string) || instanceRoot;
      const fullDir = path.resolve(instanceRoot, dir);
      if (!fullDir.startsWith(instanceRoot)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }
      const locks = await lockService.listLocks(fullDir);
      res.json({ locks });
    } catch {
      res.status(500).json({ error: "Failed to list locks" });
    }
  });

  // POST /artifacts/locks/force-release — admin force release
  router.post("/artifacts/locks/force-release", async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: "filePath required" });
      const fullPath = path.resolve(instanceRoot, filePath);
      if (!fullPath.startsWith(instanceRoot)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }
      const released = await lockService.forceRelease(fullPath);
      res.json({ released });
    } catch {
      res.status(500).json({ error: "Failed to force release lock" });
    }
  });

  return router;
}
