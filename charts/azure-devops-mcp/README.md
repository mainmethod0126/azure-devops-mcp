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
  sessionMode: stateless
  allowedOrigins:
    - https://copilot.microsoft.com
    - https://chat.openai.com
```

## Notes

- The chart defaults to `replicaCount: 3` and applies a soft `podAntiAffinity` on `kubernetes.io/hostname` so replicas spread across nodes when the cluster has capacity. You can tune or disable this with `defaultPodAntiAffinity.topologyKey` and `defaultPodAntiAffinity.enabled`.
- User-supplied `affinity` fully overrides the generated default anti-affinity. Set `replicaCount: 1` or provide custom scheduling rules if you need a different placement policy.
- The chart defaults to `http.sessionMode: stateless`, which avoids `MCP-Session-Id` and works with multi-replica scheduling without sticky routing.
- If you switch `http.sessionMode` to `stateful`, MCP sessions are stored in pod memory. In that mode, use sticky routing at your ingress, service mesh, or load balancer, or fall back to `replicaCount: 1` or custom `affinity`. `http.sessionIdleTimeoutSeconds` only applies in `stateful` mode.
- `strategy.type: Recreate` remains the default.
- `readinessProbe` and `livenessProbe` intentionally treat `405 Method Not Allowed` on `GET /mcp` as healthy, matching the current Docker Compose deployment.
