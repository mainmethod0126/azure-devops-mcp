// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebApi } from "azure-devops-node-api";

import type { UserAgentComposer, UserAgentDeploymentMode } from "../useragent.js";

export const TRANSPORT_TYPES = ["stdio", "streamable-http"] as const;
export type TransportType = (typeof TRANSPORT_TYPES)[number];

export const AUTHENTICATION_TYPES = ["interactive", "azcli", "env", "envvar"] as const;
export type AuthenticationType = (typeof AUTHENTICATION_TYPES)[number];

export const HTTP_SESSION_MODES = ["stateful", "stateless"] as const;
export type HttpSessionMode = (typeof HTTP_SESSION_MODES)[number];

export interface HttpTransportConfig {
  host: string;
  port: number;
  path: string;
  authToken: string;
  allowedOrigins: string[];
  sessionMode: HttpSessionMode;
  sessionIdleTimeoutSeconds: number;
  isHosted: boolean;
}

export interface AzureDevOpsMcpCliConfig {
  organization: string;
  transport: TransportType;
  domains: string[];
  authentication: AuthenticationType;
  tenant?: string;
  http: HttpTransportConfig;
}

export interface AzureDevOpsMcpRuntime {
  config: AzureDevOpsMcpCliConfig;
  orgName: string;
  orgUrl: string;
  tenantId?: string;
  enabledDomains: Set<string>;
  getAzureDevOpsToken: () => Promise<string>;
  createConnectionProvider: (userAgentComposer: UserAgentComposer) => () => Promise<WebApi>;
  createUserAgentComposer: (deploymentMode?: UserAgentDeploymentMode) => UserAgentComposer;
  logContext: Record<string, unknown>;
}

export interface McpServerInstance {
  server: McpServer;
  userAgentComposer: UserAgentComposer;
}

export interface McpServerFactoryOptions {
  deploymentMode?: UserAgentDeploymentMode;
}

export type McpServerFactory = (options?: McpServerFactoryOptions) => McpServerInstance;
