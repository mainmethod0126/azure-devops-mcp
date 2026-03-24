// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { startStreamableHttpServer } from "../http/server.js";
import { logger } from "../logger.js";
import type { AzureDevOpsMcpCliConfig, McpServerFactory } from "../runtime/types.js";

export async function runStreamableHttpServer(config: AzureDevOpsMcpCliConfig, serverFactory: McpServerFactory): Promise<void> {
  const server = await startStreamableHttpServer({
    host: config.http.host,
    port: config.http.port,
    path: config.http.path,
    authToken: config.http.authToken,
    allowedOrigins: config.http.allowedOrigins,
    sessionMode: config.http.sessionMode,
    sessionIdleTimeoutSeconds: config.http.sessionIdleTimeoutSeconds,
    serverFactory,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down Azure DevOps MCP HTTP server", { signal });
    await server.close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  logger.info("Azure DevOps MCP HTTP server listening", {
    transport: "streamable-http",
    url: server.url,
  });
}
