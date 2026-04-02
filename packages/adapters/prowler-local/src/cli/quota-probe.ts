#!/usr/bin/env node

import { getQuotaWindows } from "../server/quota.js";

async function main() {
  const result = await getQuotaWindows();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

await main();
