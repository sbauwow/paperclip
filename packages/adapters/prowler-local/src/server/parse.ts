import type { UsageSummary } from "@paperclipai/adapter-utils";

export interface ProwlerParsedOutput {
  sessionId: string | null;
  summary: string;
  usage: UsageSummary | null;
  costUsd: number | null;
  resultJson: Record<string, unknown> | null;
}

export function isProwlerUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown session|session .* not found|could not resume|resume .* failed|invalid session/i.test(
    haystack,
  );
}

/**
 * Parse hermes quiet mode output.
 *
 * Format:
 *   <response text>
 *
 *   session_id: <id>
 *   usage: {"input_tokens": N, "output_tokens": N, "cost_usd": N.NN}
 */
export function parseProwlerOutput(stdout: string): ProwlerParsedOutput {
  const text = stdout.trim();
  if (!text) {
    return { sessionId: null, summary: "", usage: null, costUsd: null, resultJson: null };
  }

  const lines = text.split(/\r?\n/);
  let sessionId: string | null = null;
  let usage: UsageSummary | null = null;
  let costUsd: number | null = null;
  const summaryLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Parse session_id: <value>
    const sessionMatch = trimmed.match(/^session_id:\s*(.+)$/);
    if (sessionMatch) {
      sessionId = sessionMatch[1].trim();
      continue;
    }

    // Parse usage: {JSON}
    const usageMatch = trimmed.match(/^usage:\s*(\{.+\})$/);
    if (usageMatch) {
      try {
        const parsed = JSON.parse(usageMatch[1]);
        usage = {
          inputTokens: Number(parsed.input_tokens ?? parsed.inputTokens ?? 0),
          outputTokens: Number(parsed.output_tokens ?? parsed.outputTokens ?? 0),
          cachedInputTokens: Number(parsed.cache_read_tokens ?? parsed.cachedInputTokens ?? 0),
        };
        if (typeof parsed.cost_usd === "number") {
          costUsd = parsed.cost_usd;
        }
      } catch {
        // Ignore malformed usage JSON
      }
      continue;
    }

    // Everything else is response content
    summaryLines.push(line);
  }

  // Trim trailing empty lines from summary
  while (summaryLines.length > 0 && summaryLines[summaryLines.length - 1].trim() === "") {
    summaryLines.pop();
  }

  const summary = summaryLines.join("\n").trim();

  return {
    sessionId,
    summary,
    usage,
    costUsd,
    resultJson: {
      rawOutput: summary,
      ...(sessionId ? { sessionId } : {}),
      ...(usage ? { usage } : {}),
      ...(costUsd !== null ? { costUsd } : {}),
    },
  };
}
