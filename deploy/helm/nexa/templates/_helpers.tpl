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

{{/*
Kubernetes does not restart a Deployment/StatefulSet's pods just because a
ConfigMap/Secret they reference via envFrom or secretKeyRef changed value -
only a change to the pod template itself triggers a rollout. Without this,
a rotated secret (e.g. CLOUDFLARE_TUNNEL_TOKEN, POSTGRES_PASSWORD) silently
keeps the old value in already-running pods indefinitely. Every pod
template in this chart includes this in its own metadata.annotations so a
`helm upgrade` always rolls pods forward when config/secrets change.
*/}}
{{/* Hash the rendered manifest, not just .Values.config/.Values.secrets -
several ConfigMap keys (SUPABASE_PUBLIC_URL etc.) are computed from
global.domain/clusterIssuer/tlsTerminatedExternally rather than passed
through .Values.config, so hashing only the raw values map missed those
changes and pods kept stale URLs baked in from their last real restart. */}}
{{- define "nexa.podAnnotations" -}}
checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
checksum/secrets: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
{{- end -}}
