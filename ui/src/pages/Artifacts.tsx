import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentsApi } from "../api/agents";
import { artifactsApi, type ArtifactEntry, type ArtifactFile } from "../api/artifacts";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { FileText, Folder, FolderOpen, ChevronRight, ChevronDown, ArrowLeft } from "lucide-react";
import { cn, formatDate } from "../lib/utils";

function FileIcon({ entry }: { entry: ArtifactEntry }) {
  if (entry.type === "directory") return <Folder className="h-4 w-4 text-blue-500 shrink-0" />;
  const ext = entry.name.split(".").pop()?.toLowerCase();
  const color =
    ext === "md" ? "text-green-500" :
    ext === "json" ? "text-yellow-500" :
    ext === "yaml" || ext === "yml" ? "text-purple-500" :
    "text-muted-foreground";
  return <FileText className={cn("h-4 w-4 shrink-0", color)} />;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTreeItem({
  entry,
  depth,
  expanded,
  onToggle,
  onSelect,
  isSelected,
}: {
  entry: ArtifactEntry;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  isSelected: boolean;
}) {
  return (
    <button
      onClick={entry.type === "directory" ? onToggle : onSelect}
      className={cn(
        "flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors rounded-sm",
        isSelected && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {entry.type === "directory" ? (
        expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
      ) : (
        <span className="w-3" />
      )}
      <FileIcon entry={entry} />
      <span className="truncate flex-1">{entry.name}</span>
      {entry.type === "file" && (
        <span className="text-xs text-muted-foreground shrink-0">{formatSize(entry.size)}</span>
      )}
    </button>
  );
}

function FileViewer({ file }: { file: ArtifactFile }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{file.name}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {formatSize(file.size)} | {file.modified ? formatDate(file.modified) : ""}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground">
          {file.content}
        </pre>
      </div>
    </div>
  );
}

type ArtifactScope = "company" | "agent";

export function Artifacts() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [scope, setScope] = useState<ArtifactScope>("company");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setBreadcrumbs([{ label: "Artifacts" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Company-level artifacts tree
  const { data: companyTree, isLoading: companyTreeLoading } = useQuery({
    queryKey: ["artifacts", "company-tree", selectedCompanyId],
    queryFn: () => artifactsApi.companyTree(selectedCompanyId!),
    enabled: !!selectedCompanyId && scope === "company",
  });

  // Agent-level artifacts tree
  const { data: agentTree, isLoading: agentTreeLoading } = useQuery({
    queryKey: ["artifacts", "agent-tree", selectedAgentId],
    queryFn: () => artifactsApi.agentTree(selectedAgentId!),
    enabled: !!selectedAgentId && scope === "agent",
  });

  const tree = scope === "company" ? companyTree : agentTree;
  const treeLoading = scope === "company" ? companyTreeLoading : agentTreeLoading;

  // File content - route to correct API based on scope
  const { data: fileContent, isLoading: fileLoading } = useQuery({
    queryKey: ["artifacts", scope, scope === "company" ? selectedCompanyId : selectedAgentId, selectedFile],
    queryFn: () =>
      scope === "company"
        ? artifactsApi.companyFile(selectedCompanyId!, selectedFile!)
        : artifactsApi.agentFile(selectedAgentId!, selectedFile!),
    enabled: !!(scope === "company" ? selectedCompanyId : selectedAgentId) && !!selectedFile,
  });

  // Auto-select first agent when switching to agent scope
  useEffect(() => {
    if (scope === "agent" && agents?.length && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId, scope]);

  // Build tree structure
  const treeItems = useMemo(() => {
    if (!tree?.files) return [];
    // Sort: directories first, then files, alphabetical
    return [...tree.files].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }, [tree]);

  function toggleDir(dirPath: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }

  function isVisible(entry: ArtifactEntry): boolean {
    const parts = entry.path.split("/");
    if (parts.length <= 1) return true;
    // Check all parent directories are expanded
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join("/");
      if (!expandedDirs.has(parentPath)) return false;
    }
    return true;
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={FileText} message="Select a company to view artifacts." />;
  }

  return (
    <div className="flex h-full">
      {/* Left panel: scope tabs + selector + file tree */}
      <div className="w-72 border-r border-border flex flex-col shrink-0">
        {/* Scope tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => { setScope("company"); setSelectedFile(null); setExpandedDirs(new Set()); }}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-medium transition-colors",
              scope === "company" ? "bg-accent text-foreground border-b-2 border-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Company
          </button>
          <button
            onClick={() => { setScope("agent"); setSelectedFile(null); setExpandedDirs(new Set()); }}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-medium transition-colors",
              scope === "agent" ? "bg-accent text-foreground border-b-2 border-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Agents
          </button>
        </div>

        {/* Agent selector (only in agent scope) */}
        {scope === "agent" && (
          <div className="px-3 py-2 border-b border-border">
            <select
              value={selectedAgentId ?? ""}
              onChange={(e) => {
                setSelectedAgentId(e.target.value || null);
                setSelectedFile(null);
                setExpandedDirs(new Set());
              }}
              className="w-full text-sm bg-background border border-border rounded px-2 py-1.5"
            >
              <option value="">Select agent...</option>
              {agents?.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* File tree */}
        <div className="flex-1 overflow-auto py-1">
          {treeLoading ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Loading files...</div>
          ) : treeItems.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {scope === "company"
                ? "No company artifacts yet"
                : selectedAgentId
                  ? "No agent artifacts found"
                  : "Select an agent"}
            </div>
          ) : (
            treeItems.filter(isVisible).map((entry) => {
              const depth = entry.path.split("/").length - 1;
              return (
                <FileTreeItem
                  key={entry.path}
                  entry={entry}
                  depth={depth}
                  expanded={expandedDirs.has(entry.path)}
                  onToggle={() => toggleDir(entry.path)}
                  onSelect={() => setSelectedFile(entry.path)}
                  isSelected={selectedFile === entry.path}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Right panel: file viewer */}
      <div className="flex-1 min-w-0">
        {fileLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading file...
          </div>
        ) : fileContent ? (
          <FileViewer file={fileContent} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a file to view its contents
          </div>
        )}
      </div>
    </div>
  );
}
