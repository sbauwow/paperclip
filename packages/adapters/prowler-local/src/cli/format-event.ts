import type { TranscriptEntry } from "@paperclipai/adapter-utils";

export function printProwlerStreamEvent(entry: TranscriptEntry, write: (line: string, debug: boolean) => void) {
  switch (entry.kind) {
    case "assistant":
      write(`[assistant] ${entry.text}`, false);
      return;
    case "thinking":
      write(`[thinking] ${entry.text}`, true);
      return;
    case "tool_call":
      write(`[tool_call] ${entry.name}`, true);
      return;
    case "tool_result":
      write(`[tool_result] ${entry.content}`, true);
      return;
    case "result":
      write(`[result] ${entry.text}`, false);
      return;
    case "stdout":
      write(entry.text, false);
      return;
    default:
      write(JSON.stringify(entry), true);
  }
}
