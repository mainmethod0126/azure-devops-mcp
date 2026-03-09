// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getBearerHandler, WebApi } from "azure-devops-node-api";

import { createAuthenticator } from "../auth.js";
import { isGitHubCodespaceEnv } from "../bootstrap/cli.js";
import { getOrgTenant } from "../org-tenants.js";
import { DomainsManager } from "../shared/domains.js";
import { UserAgentComposer, type UserAgentDeploymentMode } from "../useragent.js";
import { packageVersion } from "../version.js";
import type { AzureDevOpsMcpCliConfig, AzureDevOpsMcpRuntime } from "./types.js";

export async function createSharedRuntime(config: AzureDevOpsMcpCliConfig): Promise<AzureDevOpsMcpRuntime> {
  const orgName = config.organization;
  const orgUrl = `https://dev.azure.com/${orgName}`;
  const enabledDomains = new DomainsManager(config.domains).getEnabledDomains();
  const tenantId = (await getOrgTenant(orgName)) ?? config.tenant;
  const getAzureDevOpsToken = createAuthenticator(config.authentication, tenantId);

  const createUserAgentComposer = (deploymentMode: UserAgentDeploymentMode = "local"): UserAgentComposer =>
    new UserAgentComposer(packageVersion, deploymentMode);

  return {
    config,
    orgName,
    orgUrl,
    tenantId,
    enabledDomains,
    getAzureDevOpsToken,
    createConnectionProvider: (userAgentComposer) => async () => {
      const accessToken = await getAzureDevOpsToken();
      const authHandler = getBearerHandler(accessToken);

      return new WebApi(orgUrl, authHandler, undefined, {
        productName: "AzureDevOps.MCP",
        productVersion: packageVersion,
        userAgent: userAgentComposer.userAgent,
      });
    },
    createUserAgentComposer,
    logContext: {
      organization: orgName,
      organizationUrl: orgUrl,
      authentication: config.authentication,
      tenant: config.tenant,
      resolvedTenant: tenantId,
      domains: config.domains,
      enabledDomains: Array.from(enabledDomains),
      transport: config.transport,
      version: packageVersion,
      isCodespace: isGitHubCodespaceEnv(),
      httpHost: config.http.host,
      httpPort: config.http.port,
      httpPath: config.http.path,
      httpAllowedOrigins: config.http.allowedOrigins,
      httpSessionIdleTimeoutSeconds: config.http.sessionIdleTimeoutSeconds,
      httpHosted: config.http.isHosted,
      httpAuthTokenConfigured: config.transport === "streamable-http",
    },
  };
}
