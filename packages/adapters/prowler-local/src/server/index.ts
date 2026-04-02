export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { getQuotaWindows } from "./quota.js";
export { listSkills, syncSkills } from "./skills.js";
import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

export const sessionCodec: AdapterSessionCodec = {
  deserialize() {
    return null;
  },
  serialize() {
    return null;
  },
  getDisplayId() {
    return null;
  },
};
