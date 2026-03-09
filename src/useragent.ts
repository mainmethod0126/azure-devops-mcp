// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface McpClientInfo {
  name: string;
  version: string;
}

type UserAgentDeploymentMode = "local" | "hosted";

class UserAgentComposer {
  private _userAgent: string;
  private _mcpClientInfoAppended: boolean;

  constructor(packageVersion: string, deploymentMode: UserAgentDeploymentMode = "local") {
    this._userAgent = `AzureDevOps.MCP/${packageVersion} (${deploymentMode})`;
    this._mcpClientInfoAppended = false;
  }

  get userAgent(): string {
    return this._userAgent;
  }

  public appendMcpClientInfo(info: McpClientInfo | undefined): void {
    if (!this._mcpClientInfoAppended && info && info.name && info.version) {
      this._userAgent += ` ${info.name}/${info.version}`;
      this._mcpClientInfoAppended = true;
    }
  }
}

export { UserAgentComposer, McpClientInfo, UserAgentDeploymentMode };
