import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  resolveCommandForLogs,
  renderTemplate,
  joinPromptSections,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { isProwlerUnknownSessionError, parseProwlerOutput } from "./parse.js";

export function buildProwlerArgs(input: {
  sessionId: string | null;
  model: string;
  provider: string;
  toolsets: string;
  skills: string;
  maxTurns: number;
  yolo: boolean;
  extraArgs: string[];
  prompt: string;
}) {
  const args = ["chat"];
  if (input.sessionId) args.push("--resume", input.sessionId);
  args.push("-q", input.prompt, "-Q", "--source", "tool");
  if (input.model) args.push("-m", input.model);
  if (input.provider) args.push("--provider", input.provider);
  if (input.toolsets) args.push("-t", input.toolsets);
  if (input.skills) args.push("-s", input.skills);
  if (input.maxTurns > 0) args.push("--max-turns", String(input.maxTurns));
  if (input.yolo) args.push("--yolo");
  if (input.extraArgs.length > 0) args.push(...input.extraArgs);
  return args;
}

function ensurePaperclipApiUrl(raw: string) {
  const trimmed = raw.trim() || "http://127.0.0.1:3100/api";
  return trimmed.endsWith('/api') ? trimmed : `${trimmed.replace(/\/+$/, '')}/api`;
}

function buildProwlerPrompt(ctx: AdapterExecutionContext, promptTemplate?: string) {
  const taskId =
    (typeof ctx.context.taskId === "string" && ctx.context.taskId.trim()) ||
    (typeof ctx.context.issueId === "string" && ctx.context.issueId.trim()) ||
    "";
  const taskTitle = typeof ctx.config?.taskTitle === "string" ? ctx.config.taskTitle : "";
  const taskBody = typeof ctx.config?.taskBody === "string" ? ctx.config.taskBody : "";
  const commentId = typeof ctx.context.commentId === "string" ? ctx.context.commentId.trim() : "";
  const projectName = typeof ctx.config?.projectName === "string" ? ctx.config.projectName : "";
  const paperclipApiUrl = ensurePaperclipApiUrl(
    (typeof ctx.config?.paperclipApiUrl === "string" && ctx.config.paperclipApiUrl) ||
    process.env.PAPERCLIP_API_URL ||
    "http://127.0.0.1:3100/api",
  );

  if (promptTemplate && promptTemplate.trim()) {
    return renderTemplate(promptTemplate, {
      agentId: ctx.agent.id,
      agentName: ctx.agent.name,
      companyId: ctx.agent.companyId,
      runId: ctx.runId,
      taskId,
      taskTitle,
      taskBody,
      commentId,
      projectName,
      paperclipApiUrl,
      context: ctx.context,
      agent: ctx.agent,
    });
  }

  const sections = [
    `You are \"${ctx.agent.name}\", an AI agent employee in a Paperclip-managed company.`,
    "Use terminal with curl for all Paperclip localhost API calls.",
    `Agent ID: ${ctx.agent.id}`,
    `Company ID: ${ctx.agent.companyId}`,
    `Paperclip API: ${paperclipApiUrl}`,
  ];

  if (taskId) {
    sections.push(
      `Assigned issue ID: ${taskId}`,
      taskTitle ? `Title: ${taskTitle}` : "",
      taskBody ? `Body:\n${taskBody}` : "",
      `First inspect the issue with: curl -s \"${paperclipApiUrl}/issues/${taskId}\" | python3 -m json.tool`,
      "Do the work, then mark it done and post a completion comment.",
      `Mark done: curl -s -X PATCH \"${paperclipApiUrl}/issues/${taskId}\" -H \"Content-Type: application/json\" -d '{\"status\":\"done\"}'`,
      `Comment: curl -s -X POST \"${paperclipApiUrl}/issues/${taskId}/comments\" -H \"Content-Type: application/json\" -d '{\"body\":\"DONE: <summary>\"}'`,
    );
    if (commentId) {
      sections.push(`If needed, inspect triggering comment: curl -s \"${paperclipApiUrl}/issues/${taskId}/comments/${commentId}\" | python3 -m json.tool`);
    }
  } else {
    sections.push(
      `List assigned issues with: curl -s \"${paperclipApiUrl}/companies/${ctx.agent.companyId}/issues?assigneeAgentId=${ctx.agent.id}\" | python3 -m json.tool`,
      projectName ? `Work in project directory: ${projectName}` : "",
      "Pick the highest-priority open issue and work it. If none exist, check backlog and report what you found.",
    );
  }

  return joinPromptSections(sections.filter(Boolean));
}

type BuildProwlerEnvInput = {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  context: AdapterExecutionContext["context"];
  workspaceContext: Record<string, unknown>;
  authToken: string | null | undefined;
  envConfig: Record<string, unknown>;
};

export function buildProwlerExecutionEnv(input: BuildProwlerEnvInput): Record<string, string> {
  const { runId, agent, context, workspaceContext, authToken, envConfig } = input;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServiceIntents = Array.isArray(context.paperclipRuntimeServiceIntents)
    ? context.paperclipRuntimeServiceIntents.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServices = Array.isArray(context.paperclipRuntimeServices)
    ? context.paperclipRuntimeServices.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];

  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const workspaceBranch = asString(workspaceContext.branchName, "");
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "");
  const executionWorkspaceId = asString(workspaceContext.executionWorkspaceId, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const runtimePrimaryUrl = asString(context.paperclipRuntimePrimaryUrl, "");

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (typeof context.issueId === "string" && context.issueId.trim()) env.PAPERCLIP_ISSUE_ID = context.issueId.trim();
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (workspaceCwd) env.PAPERCLIP_WORKSPACE_CWD = workspaceCwd;
  if (workspaceSource) env.PAPERCLIP_WORKSPACE_SOURCE = workspaceSource;
  if (workspaceStrategy) env.PAPERCLIP_WORKSPACE_STRATEGY = workspaceStrategy;
  if (workspaceId) env.PAPERCLIP_WORKSPACE_ID = workspaceId;
  if (executionWorkspaceId) env.PAPERCLIP_EXECUTION_WORKSPACE_ID = executionWorkspaceId;
  if (workspaceRepoUrl) env.PAPERCLIP_WORKSPACE_REPO_URL = workspaceRepoUrl;
  if (workspaceRepoRef) env.PAPERCLIP_WORKSPACE_REPO_REF = workspaceRepoRef;
  if (workspaceBranch) env.PAPERCLIP_WORKSPACE_BRANCH = workspaceBranch;
  if (workspaceWorktreePath) env.PAPERCLIP_WORKSPACE_WORKTREE_PATH = workspaceWorktreePath;
  if (agentHome) env.AGENT_HOME = agentHome;
  if (workspaceHints.length > 0) env.PAPERCLIP_WORKSPACES_JSON = JSON.stringify(workspaceHints);
  if (runtimeServiceIntents.length > 0) {
    env.PAPERCLIP_RUNTIME_SERVICE_INTENTS_JSON = JSON.stringify(runtimeServiceIntents);
  }
  if (runtimeServices.length > 0) env.PAPERCLIP_RUNTIME_SERVICES_JSON = JSON.stringify(runtimeServices);
  if (runtimePrimaryUrl) env.PAPERCLIP_RUNTIME_PRIMARY_URL = runtimePrimaryUrl;
  if (authToken && authToken.trim()) env.PAPERCLIP_API_KEY = authToken.trim();

  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  return env;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;

  const promptTemplate = asString(config.promptTemplate, "");
  const command = asString(config.command, "hermes");
  const model = asString(config.model, "").trim();
  const provider = asString(config.provider, "").trim();
  const toolsets = asString(config.toolsets, "").trim();
  const skills = asString(config.skills, "").trim();
  const maxTurns = asNumber(config.maxTurnsPerRun, 0);
  const timeoutSec = asNumber(config.timeoutSec, 300);
  const graceSec = asNumber(config.graceSec, 15);
  const yolo = asBoolean(config.yolo, false);
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const configuredCwd = asString(config.cwd, "");
  const cwd = workspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const env = buildProwlerExecutionEnv({
    runId,
    agent,
    context,
    workspaceContext,
    authToken,
    envConfig,
  });

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  await ensureCommandResolvable(command, cwd, runtimeEnv);
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const prompt = buildProwlerPrompt(ctx, promptTemplate);
  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || runtimeSessionCwd === cwd);
  const sessionId = canResumeSession ? runtimeSessionId : null;

  if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stdout",
      `[paperclip] Prowler session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}".\n`,
    );
  }

  const args = buildProwlerArgs({
    sessionId,
    model,
    provider,
    toolsets,
    skills,
    maxTurns,
    yolo,
    extraArgs,
    prompt,
  });

  if (onMeta) {
    await onMeta({
      adapterType: "prowler_local",
      command: resolvedCommand,
      cwd,
      commandArgs: args,
      env: loggedEnv,
      prompt,
      promptMetrics: { promptChars: prompt.length },
      context,
    });
  }

  const runAttempt = async (resumeSessionId: string | null) => {
    const proc = await runChildProcess(
      runId,
      command,
      buildProwlerArgs({
        sessionId: resumeSessionId,
        model,
        provider,
        toolsets,
        skills,
        maxTurns,
        yolo,
        extraArgs,
        prompt,
      }),
      {
        cwd,
        env,
        timeoutSec,
        graceSec,
        onSpawn,
        onLog,
      },
    );

    return {
      proc,
      parsed: parseProwlerOutput(proc.stdout),
    };
  };

  let attempt = await runAttempt(sessionId);
  if (
    sessionId &&
    !attempt.proc.timedOut &&
    (attempt.proc.exitCode ?? 0) !== 0 &&
    isProwlerUnknownSessionError(attempt.proc.stdout, attempt.proc.stderr)
  ) {
    await onLog(
      "stdout",
      `[paperclip] Prowler resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
    );
    attempt = await runAttempt(null);
  }

  const { proc, parsed } = attempt;
  const nonZeroExit = (proc.exitCode ?? 0) !== 0;
  const resolvedSessionId = parsed.sessionId ?? sessionId;

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: proc.timedOut,
    errorMessage: proc.timedOut
      ? `Timed out after ${timeoutSec}s`
      : nonZeroExit
        ? (proc.stderr.trim() || proc.stdout.trim() || `Prowler exited with code ${proc.exitCode ?? -1}`)
        : null,
    errorCode: proc.timedOut ? "timeout" : nonZeroExit ? "prowler_execution_failed" : null,
    usage: parsed.usage ?? undefined,
    sessionId: resolvedSessionId,
    sessionParams: resolvedSessionId ? { sessionId: resolvedSessionId, cwd } : null,
    sessionDisplayId: resolvedSessionId,
    provider: provider || null,
    biller: provider || null,
    model: model || null,
    billingType: authToken ? "api" : "unknown",
    costUsd: parsed.costUsd,
    resultJson: parsed.resultJson,
    summary: parsed.summary,
    clearSession: false,
  };
}
