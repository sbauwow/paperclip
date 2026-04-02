import { describe, expect, it } from "vitest";
import { testEnvironment } from "./test.js";

describe("prowler_local testEnvironment", () => {
  it("fails cleanly when command is missing", async () => {
    const result = await testEnvironment({
      companyId: "company",
      adapterType: "prowler_local",
      config: { command: "definitely-not-a-real-command-xyz", cwd: "/tmp" },
    });

    expect(result.adapterType).toBe("prowler_local");
    expect(result.status).toBe("fail");
    expect(result.checks.some((check) => check.code === "prowler_command_unresolvable")).toBe(true);
  });
});
