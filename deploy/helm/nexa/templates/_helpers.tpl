{{- define "nexa.fullname" -}}
{{ .Release.Name }}
{{- end -}}

{{- define "nexa.labels" -}}
app.kubernetes.io/part-of: nexa
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "nexa.selectorLabels" -}}
app.kubernetes.io/part-of: nexa
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Every container in this chart gets the full config/secret env sets via
envFrom, then adds only the handful of composed/renamed values it needs
explicitly - mirrors docker-compose.yml's per-service `environment:` blocks
as closely as k8s allows. See templates/configmap.yaml / secret.yaml.
*/}}
{{- define "nexa.envFrom" -}}
envFrom:
  - configMapRef:
      name: {{ include "nexa.fullname" . }}-config
  - secretRef:
      name: {{ include "nexa.fullname" . }}-secrets
{{- end -}}
