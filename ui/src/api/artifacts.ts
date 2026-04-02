import { api } from "./client";

export interface ArtifactEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

export interface ArtifactTree {
  agentId?: string;
  workspaceId?: string;
  root: string;
  files: ArtifactEntry[];
}

export interface ArtifactFile {
  path: string;
  name: string;
  content: string;
  size: number;
  modified: string;
}

export const artifactsApi = {
  agentTree: (agentId: string): Promise<ArtifactTree> =>
    api.get(`/api/artifacts/agents/${agentId}/tree`),

  agentFile: (agentId: string, filePath: string): Promise<ArtifactFile> =>
    api.get(`/api/artifacts/agents/${agentId}/file?path=${encodeURIComponent(filePath)}`),

  workspaceTree: (workspaceId: string): Promise<ArtifactTree> =>
    api.get(`/api/artifacts/workspaces/${workspaceId}/tree`),

  workspaceFile: (workspaceId: string, filePath: string): Promise<ArtifactFile> =>
    api.get(`/api/artifacts/workspaces/${workspaceId}/file?path=${encodeURIComponent(filePath)}`),

  companyTree: (companyId: string): Promise<ArtifactTree> =>
    api.get(`/api/artifacts/companies/${companyId}/tree`),

  companyFile: (companyId: string, filePath: string): Promise<ArtifactFile> =>
    api.get(`/api/artifacts/companies/${companyId}/file?path=${encodeURIComponent(filePath)}`),
};
