import type { UsageSummary } from "@paperclipai/adapter-utils";

export interface ProwlerParsedOutput {
  sessionId: string | null;
  summary: string;
  usage: UsageSummary | null;
  resultJson: Record<string, unknown> | null;
}

function trimFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function parseProwlerOutput(stdout: string): ProwlerParsedOutput {
  const text = stdout.trim();
  if (!text) {
    return {
      sessionId: null,
      summary: "",
      usage: null,
      resultJson: null,
    };
  }

  const cleaned = trimFence(text);
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const summary = typeof parsed.response === "string"
      ? parsed.response
      : typeof parsed.result === "string"
        ? parsed.result
        : typeof parsed.message === "string"
          ? parsed.message
          : text;
    const usage = parsed.usage && typeof parsed.usage === "object"
      ? {
          inputTokens: Number((parsed.usage as Record<string, unknown>).inputTokens ?? 0),
          outputTokens: Number((parsed.usage as Record<string, unknown>).outputTokens ?? 0),
          cachedInputTokens: Number((parsed.usage as Record<string, unknown>).cachedInputTokens ?? 0),
        }
      : null;

    return {
      sessionId:
        typeof parsed.sessionId === "string"
          ? parsed.sessionId
          : typeof parsed.session_id === "string"
            ? parsed.session_id
            : null,
      summary: summary.trim(),
      usage,
      resultJson: parsed,
    };
  } catch {
    return {
      sessionId: null,
      summary: text,
      usage: null,
      resultJson: { rawOutput: text },
    };
  }
}
