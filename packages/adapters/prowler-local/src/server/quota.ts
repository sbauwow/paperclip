import type { ProviderQuotaResult } from "@paperclipai/adapter-utils";

export async function getQuotaWindows(): Promise<ProviderQuotaResult> {
  return {
    provider: "prowler_local",
    ok: false,
    error:
      "Prowler local quota polling is not implemented yet. Quota depends on the configured Hermes provider/model path.",
    windows: [],
  };
}
