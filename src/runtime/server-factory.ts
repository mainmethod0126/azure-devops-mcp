// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { configureAllTools } from "../tools.js";
import { packageVersion } from "../version.js";
import type { AzureDevOpsMcpRuntime, McpServerFactory, McpServerFactoryOptions, McpServerInstance } from "./types.js";

export function createMcpServerFactory(runtime: AzureDevOpsMcpRuntime): McpServerFactory {
  return (options: McpServerFactoryOptions = {}): McpServerInstance => createConfiguredServer(runtime, options);
}

function createConfiguredServer(runtime: AzureDevOpsMcpRuntime, options: McpServerFactoryOptions): McpServerInstance {
  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });

  const userAgentComposer = runtime.createUserAgentComposer(options.deploymentMode);

  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  configureAllTools(
    server,
    runtime.getAzureDevOpsToken,
    runtime.createConnectionProvider(userAgentComposer),
    () => userAgentComposer.userAgent,
    runtime.enabledDomains
  );

  return {
    server,
    userAgentComposer,
  };
}
