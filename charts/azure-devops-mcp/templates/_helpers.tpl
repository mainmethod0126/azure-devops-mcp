{{- define "azure-devops-mcp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "azure-devops-mcp.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "azure-devops-mcp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "azure-devops-mcp.labels" -}}
helm.sh/chart: {{ include "azure-devops-mcp.chart" . }}
{{ include "azure-devops-mcp.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "azure-devops-mcp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "azure-devops-mcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "azure-devops-mcp.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "azure-devops-mcp.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "azure-devops-mcp.secretName" -}}
{{- required "values.secrets.existingSecret.name is required" .Values.secrets.existingSecret.name -}}
{{- end -}}

{{- define "azure-devops-mcp.probeScript" -}}
const path = process.env.ADO_MCP_HTTP_PATH || '/mcp'; const token = process.env.ADO_MCP_HTTP_AUTH_TOKEN; fetch('http://127.0.0.1:{{ .Values.http.port }}' + path, { headers: { Authorization: 'Bearer ' + token } }).then((response) => process.exit(response.status === 405 ? 0 : 1)).catch(() => process.exit(1));
{{- end -}}
