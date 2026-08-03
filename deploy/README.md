# CI/CD

Two workflows under [`.github/workflows`](../.github/workflows):

- **`ci.yml`** - on every PR and push to `main`: builds the portal image
  (no push), `helm lint`s and renders the chart, validates the rendered
  manifests against the Kubernetes API schema (via
  [kubeconform](https://github.com/yannh/kubeconform)), and fails if
  `apps/*/migrations/*.sql` is out of date relative to its `schema/*.yml`
  source (i.e. someone edited the YAML and forgot to recompile).
- **`deploy.yml`** - on push to `main` (or manually via "Run workflow"):
  builds and pushes the portal image to GHCR, then
  `helm upgrade --install`s [`deploy/helm/nexa`](./helm/nexa) against your
  cluster.

Deploying is otherwise the same chart you'd install yourself - see
[`deploy/helm/nexa/README.md`](./helm/nexa/README.md) for what it actually
deploys and its known limitations (single-namespace-per-release, storage
access modes, etc).

## Required GitHub Actions secrets

**Settings -> Secrets and variables -> Actions -> Secrets**, on the repo.

### Cluster access

| Secret | What |
| --- | --- |
| `KUBE_CONFIG` | A kubeconfig for the target cluster, **base64-encoded** (`cat ~/.kube/config \| base64 -w0`). Scope this to a service account with access to just the `nexa` namespace if your cluster supports it - the workflow only needs to create/update objects there. |

Nothing is needed for the container registry: images are pushed to GHCR
(`ghcr.io/<owner>/nexa-portal`) using the workflow's automatic
`GITHUB_TOKEN`. The one thing to check is that your repo allows it write
access: **Settings -> Actions -> General -> Workflow permissions -> Read
and write permissions**.

### Application secrets

Everything below is a value from `.env.example` at the repo root that's
sensitive - same secrets, same meaning, just deployed via Kubernetes
Secret instead of a `.env` file. Generate them the same way you would
locally:

```sh
sh scripts/generate-keys.sh
```

This prints `KEY=value` lines - paste each value into the matching GitHub
secret below (**do not** pass `--update-env`, that writes to a local
`.env` you don't need here).

| Secret | From `generate-keys.sh`? | Notes |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | yes | |
| `JWT_SECRET` | yes | |
| `ANON_KEY` | yes | derived from `JWT_SECRET` - keep them from the same run |
| `SERVICE_ROLE_KEY` | yes | derived from `JWT_SECRET` - keep them from the same run |
| `SECRET_KEY_BASE` | yes | |
| `REALTIME_DB_ENC_KEY` | yes | |
| `VAULT_ENC_KEY` | yes | |
| `PG_META_CRYPTO_KEY` | yes | |
| `S3_PROTOCOL_ACCESS_KEY_ID` | yes | |
| `S3_PROTOCOL_ACCESS_KEY_SECRET` | yes | |
| `DASHBOARD_PASSWORD` | yes | HTTP Basic Auth password for Supabase Studio |
| `MB_DB_PASS` | yes | Metabase's own Postgres app-database password |
| `METABASE_ADMIN_PASSWORD` | yes | bootstraps the Metabase admin account on first deploy |
| `SUPABASE_PUBLISHABLE_KEY` | no | optional opaque API key - leave the GitHub secret unset (empty) unless you've set this up, see the Supabase self-hosting docs |
| `SUPABASE_SECRET_KEY` | no | optional opaque API key - same as above |
| `JWT_KEYS` | no | optional, advanced asymmetric-JWT setup - leave empty |
| `JWT_JWKS` | no | optional, advanced asymmetric-JWT setup - leave empty |
| `ANON_KEY_ASYMMETRIC` | no | optional, advanced asymmetric-JWT setup - leave empty |
| `SERVICE_ROLE_KEY_ASYMMETRIC` | no | optional, advanced asymmetric-JWT setup - leave empty |
| `GOOGLE_SECRET` | no | only if enabling Google SSO - see the root README |
| `SMTP_PASS` | no | only if configuring real SMTP for email flows |
| `OPENAI_API_KEY` | no | only to enable Studio's AI Assistant |

A secret left unset in GitHub resolves to an empty string in the workflow
(`${{ secrets.FOO }}` is `""` when `FOO` doesn't exist) - fine for the
"no" rows above, since the chart's own default is also empty. It is
**not** fine for the "yes" rows - those need a real value or the
deployment will come up with insecure/broken defaults.

### Required GitHub Actions variables (non-secret)

**Settings -> Secrets and variables -> Actions -> Variables** - these
control the deployment's public URLs and aren't sensitive, so they don't
need to be secrets.

| Variable | What | Default if unset |
| --- | --- | --- |
| `NEXA_DOMAIN` | Base domain - portal at this host, Kong at `api.<domain>`, Metabase at `analytics.<domain>` | none, must be set |
| `NEXA_INGRESS_CLASS` | Your ingress controller's `ingressClassName` | `nginx` |
| `NEXA_CLUSTER_ISSUER` | A cert-manager `ClusterIssuer` name, for TLS | none (serves plain HTTP) |

### Optional: gate deploys behind manual approval

`deploy.yml`'s deploy job runs under the `production` GitHub Environment.
Add protection rules to it (**Settings -> Environments -> production ->
Required reviewers**) to require a manual approval click before every
deploy, without changing the workflow itself.
