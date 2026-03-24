// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { packageVersion } from "../version.js";
import { AUTHENTICATION_TYPES, HTTP_SESSION_MODES, TRANSPORT_TYPES, type AzureDevOpsMcpCliConfig } from "../runtime/types.js";
import { buildCliConfig, isGitHubCodespaceEnv } from "./config.js";

export function parseCliConfig(argv: string[] = hideBin(process.argv)): AzureDevOpsMcpCliConfig {
  const parsed = yargs(argv)
    .scriptName("mcp-server-azuredevops")
    .usage("Usage: $0 <organization> [options]")
    .version(packageVersion)
    .command("$0 <organization> [options]", "Azure DevOps MCP Server", (commandYargs) => {
      commandYargs.positional("organization", {
        describe: "Azure DevOps organization name",
        type: "string",
        demandOption: true,
      });
    })
    .option("transport", {
      describe: "Transport to use for the MCP server",
      type: "string",
      choices: [...TRANSPORT_TYPES],
      default: "stdio",
    })
    .option("domains", {
      alias: "d",
      describe: "Domain(s) to enable: 'all' for everything, or specific domains like 'repositories builds work'. Defaults to 'all'.",
      type: "string",
      array: true,
      default: ["all"],
    })
    .option("authentication", {
      alias: "a",
      describe: "Type of authentication to use",
      type: "string",
      choices: [...AUTHENTICATION_TYPES],
    })
    .option("tenant", {
      alias: "t",
      describe: "Azure tenant ID (optional, applied when using 'interactive' and 'azcli' type of authentication)",
      type: "string",
    })
    .option("http-host", {
      describe: "Host to bind the streamable HTTP server to",
      type: "string",
      default: "127.0.0.1",
    })
    .option("http-port", {
      describe: "Port to bind the streamable HTTP server to",
      type: "number",
      default: 3001,
    })
    .option("http-path", {
      describe: "Path to serve the MCP HTTP endpoint from",
      type: "string",
      default: "/mcp",
    })
    .option("http-auth-token", {
      describe: "Static bearer token required to access the streamable HTTP endpoint",
      type: "string",
    })
    .option("http-allowed-origin", {
      describe: "Allowed browser origin for streamable HTTP requests. Repeat to allow multiple origins.",
      type: "string",
      array: true,
      default: [],
    })
    .option("http-session-mode", {
      describe: "Session mode for the streamable HTTP server",
      type: "string",
      choices: [...HTTP_SESSION_MODES],
      default: "stateless",
    })
    .option("http-session-idle-timeout-seconds", {
      describe: "Idle timeout for stateful HTTP sessions in seconds",
      type: "number",
      default: 1800,
    })
    .strict()
    .help()
    .parseSync();

  return buildCliConfig({
    organization: parsed.organization as string,
    transport: parsed.transport as AzureDevOpsMcpCliConfig["transport"],
    domains: parsed.domains as string[] | undefined,
    authentication: parsed.authentication as AzureDevOpsMcpCliConfig["authentication"] | undefined,
    tenant: parsed.tenant as string | undefined,
    httpHost: parsed.httpHost as string,
    httpPort: parsed.httpPort as number,
    httpPath: parsed.httpPath as string,
    httpAuthToken: parsed.httpAuthToken as string | undefined,
    httpAllowedOrigin: parsed.httpAllowedOrigin as string[] | undefined,
    httpSessionMode: parsed.httpSessionMode as AzureDevOpsMcpCliConfig["http"]["sessionMode"],
    httpSessionIdleTimeoutSeconds: parsed.httpSessionIdleTimeoutSeconds as number,
  });
}

export { isGitHubCodespaceEnv } from "./config.js";
