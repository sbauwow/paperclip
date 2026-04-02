import { describe, expect, it } from "vitest";
import { parseProwlerOutput } from "./parse.js";

describe("parseProwlerOutput", () => {
  it("returns plain text summary when output is not JSON", () => {
    const result = parseProwlerOutput("hello from prowler");
    expect(result.summary).toBe("hello from prowler");
    expect(result.sessionId).toBeNull();
  });

  it("parses JSON output when provided", () => {
    const result = parseProwlerOutput(JSON.stringify({ sessionId: "abc123", response: "done", usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 } }));
    expect(result.sessionId).toBe("abc123");
    expect(result.summary).toBe("done");
    expect(result.usage?.inputTokens).toBe(10);
  });
});
