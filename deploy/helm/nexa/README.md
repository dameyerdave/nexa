# nexa Helm chart

Deploys the full stack (Supabase self-hosted, Metabase, the portal) to a
Kubernetes cluster. This is a direct, mostly 1:1 translation of the root
[`docker-compose.yml`](../../../docker-compose.yml) - when in doubt about
what a given env var or setting does, that file (and the root
[README](../../../README.md)) is the reference.

## Design choices / known limitations

- **One release per namespace.** Most Services are deliberately named
  without the Helm release prefix (`auth`, `rest`, `kong`, `db`, ...) so
  `kong.yml`'s hardcoded upstream hostnames (`http://auth:9999`, etc.)
  resolve without modification - install a second release into the same
  namespace and these will collide. Give each environment (staging, prod,
  ...) its own namespace.
- **Config files are symlinked, not duplicated.** `templates/files` is a
  symlink to `../../../volumes` so Kong's config, the Postgres init SQL,
  and `pooler.exs` stay single-sourced with docker-compose. One hostname
  inside `kong.yml` (`realtime-dev.supabase-realtime`, invalid as a k8s
  Service name because of the dot) is rewritten to `realtime` at render
  time - see the comment in `templates/configmap-kong.yaml`. This hasn't
  been verified against `realtime-js` client behavior, which may care
  about that hostname for tenant resolution.
- **Storage is a single PersistentVolumeClaim**, mounted by both the
  `storage` and `imgproxy` Deployments. `ReadWriteOnce` (the default) only
  works if both pods land on the same node - fine for a single-node
  cluster, but a real multi-node cluster needs an RWX-capable
  `storageClassName` (NFS, Longhorn, EFS-CSI, ...). See
  `values.persistence.storage`.
- **Supavisor's pooled Postgres ports (5432/6543) are ClusterIP-only.**
  Exposing raw Postgres wire protocol outside the cluster needs a
  LoadBalancer/NodePort Service or a TCP-mode Ingress, which is
  cloud/ingress-controller specific - add it yourself if you need direct
  external `psql` access.
- **Ingress is one of two ways in - `cloudflared` is the other.** Set
  `global.ingressEnabled: false` and `cloudflared.enabled: true` to reach
  the cluster via a Cloudflare Tunnel instead of an Ingress
  controller/LoadBalancer (no public IP needed). Routing (which public
  hostname maps to which in-cluster Service) is configured on Cloudflare's
  side, not in this chart - see `deploy/README.md`'s "Cloudflare Tunnel"
  section. Pair it with `global.tlsTerminatedExternally: true` so the
  computed public URLs (`SITE_URL`, `SUPABASE_PUBLIC_URL`, ...) still come
  out as `https://` even with no `clusterIssuer` set.
- **No apps/ schema or dashboards are applied by this chart.** Once the
  stack is up, run `scripts/apply_schema.sh` / `scripts/apply_dashboards.py`
  against it the same way you would locally (see the root README) - they
  just need `POSTGRES_*`/`METABASE_*` pointed at the cluster instead of
  `localhost` (e.g. via `kubectl port-forward`).

## Values you actually need to set

| Key | What |
| --- | --- |
| `global.domain` | Base domain - portal at this host, Kong at `api.<domain>`, Metabase at `analytics.<domain>` |
| `global.ingressClassName` | Your ingress controller's class (default `nginx`) |
| `global.clusterIssuer` | A cert-manager `ClusterIssuer` name to get TLS; leave empty for plain HTTP |
| `global.storageClassName` | Leave empty for your cluster's default `StorageClass` |
| `images.portal.repository` / `.tag` | Set by CI to the image it just built and pushed |
| `secrets.*` | Every value in `.env.example` at the repo root that's sensitive - **never commit real values**, see below |

## Secrets

`values.yaml`'s `secrets:` block only documents the expected keys with
placeholder values - deploying with those as-is is intentionally insecure
and only fit for a local smoke test. For anything real, generate a
`values-secrets.yaml` (gitignored) the same way `.env` is generated
locally:

```sh
sh scripts/generate-keys.sh   # prints the values, don't --update-env here
```

then write them into a `secrets:` block in `values-secrets.yaml` and
deploy with:

```sh
helm upgrade --install nexa deploy/helm/nexa \
  -f deploy/helm/nexa/values-secrets.yaml \
  --set global.domain=your-domain.example.com \
  --set images.portal.tag=<git-sha>
```

The GitHub Actions deploy workflow does exactly this, sourcing each value
from a GitHub Actions secret instead of a local file - see
`.github/workflows/deploy.yml` and the root README's CI/CD section for the
full list of what to configure in the repo.

## Local smoke test (kind/k3d)

```sh
kind create cluster --name nexa
helm install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx --namespace ingress-nginx --create-namespace

helm install nexa deploy/helm/nexa \
  --set global.domain=nexa.localtest.me \
  --set images.portal.repository=nexa-portal --set images.portal.tag=local

kubectl get pods -w
```

`*.localtest.me` always resolves to `127.0.0.1`, so once ingress-nginx has
an external IP (`kubectl port-forward` it if your kind cluster has no real
LoadBalancer support) you can hit `http://nexa.localtest.me` directly.
