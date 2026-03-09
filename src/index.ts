#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { pathToFileURL } from "node:url";

import { createBootstrapContext } from "./bootstrap/context.js";
import { runStreamableHttpServer } from "./bootstrap/http-runner.js";
import { runStdioServer } from "./bootstrap/stdio-runner.js";
import { logger } from "./logger.js";

export let orgName = "";

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

export async function main(argv?: string[]): Promise<void> {
  const context = await createBootstrapContext(argv);

  orgName = context.config.organization;

  logger.info("Starting Azure DevOps MCP Server", context.runtime.logContext);

  if (context.config.transport === "stdio") {
    await runStdioServer(context.serverFactory);
    return;
  }

  await runStreamableHttpServer(context.config, context.serverFactory);
}

if (isMainModule()) {
  main().catch((error) => {
    logger.error("Fatal error in main():", error);
    process.exit(1);
  });
}
