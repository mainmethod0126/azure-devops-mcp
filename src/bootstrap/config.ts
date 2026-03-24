// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DomainsManager } from "../shared/domains.js";
import { type AuthenticationType, type AzureDevOpsMcpCliConfig, type HttpSessionMode, type TransportType } from "../runtime/types.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

export interface ParsedCliArgs {
  organization: string;
  transport: TransportType;
  domains?: string[];
  authentication?: AuthenticationType;
  tenant?: string;
  httpHost: string;
  httpPort: number;
  httpPath: string;
  httpAuthToken?: string;
  httpAllowedOrigin?: string[];
  httpSessionMode: HttpSessionMode;
  httpSessionIdleTimeoutSeconds: number;
}

export function isGitHubCodespaceEnv(): boolean {
  return process.env.CODESPACES === "true" && !!process.env.CODESPACE_NAME;
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function buildCliConfig(parsed: ParsedCliArgs): AzureDevOpsMcpCliConfig {
  const organization = parsed.organization.trim();
  const httpHost = parsed.httpHost.trim();
  const httpPath = normalizeHttpPath(parsed.httpPath);
  const httpAuthToken = parsed.httpAuthToken?.trim() || process.env.ADO_MCP_HTTP_AUTH_TOKEN?.trim();
  const httpSessionMode = parsed.httpSessionMode;
  const isHosted = parsed.transport === "streamable-http" && !isLoopbackHost(httpHost);
  const authentication = resolveAuthentication(parsed.authentication, isHosted);

  if (!organization) {
    throw new Error("Azure DevOps organization name cannot be empty.");
  }

  validatePort(parsed.httpPort);
  if (parsed.transport === "streamable-http" && httpSessionMode === "stateful") {
    validateIdleTimeoutSeconds(parsed.httpSessionIdleTimeoutSeconds);
  }
  validateHostedAuthentication(authentication, isHosted);

  if (parsed.transport === "streamable-http" && !httpAuthToken) {
    throw new Error("HTTP transport requires --http-auth-token or the ADO_MCP_HTTP_AUTH_TOKEN environment variable.");
  }

  return {
    organization,
    transport: parsed.transport,
    domains: DomainsManager.parseDomainsInput(parsed.domains),
    authentication,
    tenant: parsed.tenant?.trim() || undefined,
    http: {
      host: httpHost,
      port: parsed.httpPort,
      path: httpPath,
      authToken: httpAuthToken ?? "",
      allowedOrigins: normalizeOrigins(parsed.httpAllowedOrigin),
      sessionMode: httpSessionMode,
      sessionIdleTimeoutSeconds: parsed.httpSessionIdleTimeoutSeconds,
      isHosted,
    },
  };
}

function normalizeHttpPath(path: string): string {
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    throw new Error("HTTP path cannot be empty.");
  }

  return trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`HTTP port must be an integer between 1 and 65535. Received '${port}'.`);
  }
}

function validateIdleTimeoutSeconds(timeout: number): void {
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new Error(`HTTP session idle timeout must be a positive integer. Received '${timeout}'.`);
  }
}

function resolveAuthentication(authentication: AuthenticationType | undefined, isHosted: boolean): AuthenticationType {
  if (authentication) {
    return authentication;
  }

  if (isHosted) {
    return "env";
  }

  return isGitHubCodespaceEnv() ? "azcli" : "interactive";
}

function validateHostedAuthentication(authentication: AuthenticationType, isHosted: boolean): void {
  if (!isHosted) {
    return;
  }

  if (authentication === "interactive") {
    throw new Error("Interactive authentication is not allowed when streamable-http binds to a non-loopback host. Use 'env' or 'envvar'.");
  }

  if (authentication !== "env" && authentication !== "envvar") {
    throw new Error(`Authentication '${authentication}' is not allowed when streamable-http binds to a non-loopback host. Use 'env' or 'envvar'.`);
  }
}

function normalizeOrigins(origins: string[] | undefined): string[] {
  return (origins ?? []).map((origin) => origin.trim()).filter((origin) => origin.length > 0);
}
