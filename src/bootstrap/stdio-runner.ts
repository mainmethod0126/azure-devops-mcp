// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { McpServerFactory } from "../runtime/types.js";

export async function runStdioServer(serverFactory: McpServerFactory): Promise<void> {
  const { server } = serverFactory({ deploymentMode: "local" });
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
