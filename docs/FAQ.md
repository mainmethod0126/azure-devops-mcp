# Frequently Asked Questions

Before you get started, ensure you follow the steps in the `README.md` file. This will help you get up and running and connected to your Azure DevOps organization.

## Does the MCP Server support both Azure DevOps Services and on-premises deployments?

This MCP Server supports only Azure DevOps Services. Several required API endpoints are not yet available for on-premises deployments. We currently do not have plans to support Azure DevOps on-prem.

## Can I connect to more than one organization at a time?

No, you can connect to only one organization at a time. However, you can switch organizations as needed.

## Can I set a default project instead of fetching the list every time?

Currently, you need to fetch the list of projects so the LLM has context about the project name or ID. We plan to improve this experience in the future by leveraging prompts. In the meantime, you can set a default project name in your `copilot-instructions.md` file.

## Are PAT's supported?

Yes. PATs can be used for Azure DevOps access through the `envvar` authentication mode by setting `ADO_MCP_AUTH_TOKEN` on the server host.

For hosted `streamable-http` deployments, keep that Azure DevOps credential separate from the MCP access secret presented by the client in the `Authorization` header.

## Is there a remote supported version of the MCP Server?

Yes. In addition to the local `stdio` experience, the project supports an optional self-hosted `streamable-http` deployment model.

The repository does not currently publish a built-in public hosted URL, so clients must connect to your own HTTPS endpoint and provide an `Authorization: Bearer <secret>` header when prompted.

## Are personal accounts supported?

Unfortunately, personal accounts are not supported. To maintain a higher level of authentication and security, your account must be backed by Entra ID. If you receive an error message like this, it means you are using a personal account.

![image of login error for personal accounts](./media/personal-accounts-error.png)

## When will a remote Azure DevOps MCP Server be available?

The server now supports self-hosted remote deployments through `streamable-http`.

If Microsoft later publishes a public hosted endpoint or registry `remotes` metadata entry, that availability will be announced on the public [Azure DevOps roadmap](https://learn.microsoft.com/en-us/azure/devops/release-notes/features-timeline). Until then, remote usage means running your own HTTPS deployment.
