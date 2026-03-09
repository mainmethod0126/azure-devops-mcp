# Azure DevOps MCP Helm Chart

This chart deploys the Azure DevOps MCP server in hosted `streamable-http` mode for Kubernetes.

## Prerequisites

- A published container image for this repository
- An existing Kubernetes `Secret` with both:
  - `ADO_MCP_AUTH_TOKEN`: Azure DevOps PAT used by the server
  - `ADO_MCP_HTTP_AUTH_TOKEN`: bearer secret required by MCP clients
- TLS termination at your ingress or reverse proxy if the endpoint is exposed outside the cluster

## Create the Secret

```bash
kubectl create secret generic azure-devops-mcp-secrets \
  --from-literal=ADO_MCP_AUTH_TOKEN='your-azure-devops-pat' \
  --from-literal=ADO_MCP_HTTP_AUTH_TOKEN='your-long-random-bearer-secret'
```

## Minimal values.yaml

```yaml
organization: contoso

image:
  repository: ghcr.io/your-org/azure-devops-mcp
  tag: "2.4.0"

secrets:
  existingSecret:
    name: azure-devops-mcp-secrets
```

## Install or Upgrade

```bash
helm upgrade --install azure-devops-mcp ./charts/azure-devops-mcp \
  --namespace mcp \
  --create-namespace \
  -f values.yaml
```

## Enable Ingress

The application does not terminate TLS. Expose it through an ingress or reverse proxy that handles HTTPS.

```yaml
organization: contoso

image:
  repository: ghcr.io/your-org/azure-devops-mcp
  tag: "2.4.0"

secrets:
  existingSecret:
    name: azure-devops-mcp-secrets

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  hosts:
    - host: mcp.example.com
  tls:
    - secretName: azure-devops-mcp-tls
      hosts:
        - mcp.example.com

http:
  allowedOrigins:
    - https://copilot.microsoft.com
    - https://chat.openai.com
```

## Notes

- The chart defaults to `replicaCount: 1` and `strategy.type: Recreate` because MCP sessions are stored in pod memory.
- `readinessProbe` and `livenessProbe` intentionally treat `405 Method Not Allowed` on `GET /mcp` as healthy, matching the current Docker Compose deployment.
