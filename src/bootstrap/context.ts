// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseCliConfig } from "./cli.js";
import { createSharedRuntime } from "../runtime/shared-runtime.js";
import { createMcpServerFactory } from "../runtime/server-factory.js";
import type { AzureDevOpsMcpCliConfig, AzureDevOpsMcpRuntime, McpServerFactory } from "../runtime/types.js";

export interface BootstrapContext {
  config: AzureDevOpsMcpCliConfig;
  runtime: AzureDevOpsMcpRuntime;
  serverFactory: McpServerFactory;
}

export async function createBootstrapContext(argv?: string[]): Promise<BootstrapContext> {
  const config = parseCliConfig(argv);
  const runtime = await createSharedRuntime(config);

  return {
    config,
    runtime,
    serverFactory: createMcpServerFactory(runtime),
  };
}
