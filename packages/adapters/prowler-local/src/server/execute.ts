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
import { parseProwlerOutput } from "./parse.js";

function buildProwlerArgs(input: {
  model: string;
  provider: string;
  toolsets: string;
  skills: string;
  maxTurns: number;
  yolo: boolean;
  extraArgs: string[];
  prompt: string;
}) {
  const args = ["chat", "-q", input.prompt, "-Q", "--source", "tool"];
  if (input.model) args.push("-m", input.model);
  if (input.provider) args.push("--provider", input.provider);
  if (input.toolsets) args.push("-t", input.toolsets);
  if (input.skills) args.push("-s", input.skills);
  if (input.maxTurns > 0) args.push("--max-turns", String(input.maxTurns));
  if (input.yolo) args.push("--yolo");
  if (input.extraArgs.length > 0) args.push(...input.extraArgs);
  return args;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
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
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (typeof context.issueId === "string" && context.issueId.trim()) env.PAPERCLIP_ISSUE_ID = context.issueId.trim();
  if (typeof context.wakeReason === "string" && context.wakeReason.trim()) env.PAPERCLIP_WAKE_REASON = context.wakeReason.trim();
  if (typeof context.commentId === "string" && context.commentId.trim()) env.PAPERCLIP_WAKE_COMMENT_ID = context.commentId.trim();
  if (typeof context.approvalId === "string" && context.approvalId.trim()) env.PAPERCLIP_APPROVAL_ID = context.approvalId.trim();
  if (typeof workspaceContext.workspaceId === "string" && workspaceContext.workspaceId.trim()) env.PAPERCLIP_WORKSPACE_ID = workspaceContext.workspaceId.trim();
  if (typeof workspaceContext.repoUrl === "string" && workspaceContext.repoUrl.trim()) env.PAPERCLIP_WORKSPACE_REPO_URL = workspaceContext.repoUrl.trim();
  if (typeof workspaceContext.repoRef === "string" && workspaceContext.repoRef.trim()) env.PAPERCLIP_WORKSPACE_REPO_REF = workspaceContext.repoRef.trim();
  if (typeof workspaceContext.agentHome === "string" && workspaceContext.agentHome.trim()) env.AGENT_HOME = workspaceContext.agentHome.trim();
  if (authToken && typeof authToken === "string" && authToken.trim()) env.PAPERCLIP_API_KEY = authToken.trim();

  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  await ensureCommandResolvable(command, cwd, runtimeEnv);
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const prompt = joinPromptSections([
    renderTemplate(promptTemplate, {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context,
    }),
  ]);

  const args = buildProwlerArgs({
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

  const proc = await runChildProcess(runId, command, args, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    onSpawn,
    onLog,
  });

  const parsed = parseProwlerOutput(proc.stdout);
  const nonZeroExit = (proc.exitCode ?? 0) !== 0;

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
    sessionId: parsed.sessionId,
    sessionParams: parsed.sessionId ? { sessionId: parsed.sessionId, cwd } : null,
    sessionDisplayId: parsed.sessionId,
    provider: provider || null,
    biller: provider || null,
    model: model || null,
    billingType: authToken ? "api" : "unknown",
    costUsd: null,
    resultJson: parsed.resultJson,
    summary: parsed.summary,
    clearSession: false,
  };
}
