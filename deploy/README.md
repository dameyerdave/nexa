# CI/CD

Two workflows under [`.github/workflows`](../.github/workflows):

- **`ci.yml`** - on every PR and push to `main`: builds the portal and
  roles-api images (no push), `helm lint`s and renders the chart, validates
  the rendered manifests against the Kubernetes API schema (via
  [kubeconform](https://github.com/yannh/kubeconform)), and fails if
  `apps/*/migrations/*.sql` is out of date relative to its `schema/*.yml`
  source (i.e. someone edited the YAML and forgot to recompile).
- **`deploy.yml`** - on push to `main` (or manually via "Run workflow"):
  builds and pushes the portal and roles-api images to GHCR, then
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
(`ghcr.io/<owner>/nexa-portal` and `ghcr.io/<owner>/nexa-roles-api`) using
the workflow's automatic `GITHUB_TOKEN`. The one thing to check is that
your repo allows it write access: **Settings -> Actions -> General ->
Workflow permissions -> Read and write permissions**.

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
| `CLOUDFLARE_TUNNEL_TOKEN` | no | only if using `cloudflared` instead of/alongside Ingress (see below) - the token from a tunnel created in the Cloudflare Zero Trust dashboard (Networks -> Tunnels -> your tunnel -> "Docker" install command has it embedded after `--token`) |
| `DJANGO_SECRET_KEY` | yes | roles-api's own Django secret key (unrelated to `JWT_SECRET`) |
| `ROLES_API_TOKEN` | yes | shared bearer token the portal uses to call roles-api |
| `DJANGO_SUPERUSER_PASSWORD` | yes | password for the roles-api bootstrap admin (paired with the `DJANGO_SUPERUSER_EMAIL` variable below) |

`DJANGO_SUPERUSER_EMAIL` is also required but is **not** a secret - see the
variables table below, since it's an identity, not a credential.

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
| `NEXA_ADMIN_EMAIL` | Email for roles-api's bootstrap admin (paired with the `DJANGO_SUPERUSER_PASSWORD` secret above) - see README.md "Roles and access control" | none, must be set |
| `NEXA_INGRESS_CLASS` | Your ingress controller's `ingressClassName` | `nginx` |
| `NEXA_CLUSTER_ISSUER` | A cert-manager `ClusterIssuer` name, for TLS | none (serves plain HTTP) |
| `NEXA_INGRESS_ENABLED` | Set `false` if you have no Ingress controller (e.g. relying on `cloudflared` instead) | `true` |
| `NEXA_TLS_TERMINATED_EXTERNALLY` | Set `true` when TLS is terminated somewhere this chart doesn't manage (e.g. Cloudflare's edge) so the computed public URLs still use `https://` | `false` |
| `NEXA_CLOUDFLARED_ENABLED` | Set `true` to deploy the Cloudflare Tunnel client | `false` |

These four also exist as **inputs on the "Run workflow" manual-dispatch
button** (Actions -> Deploy -> Run workflow), which override the repo
variable of the same purpose for that one run - handy for a one-off
deploy without changing the variable permanently.

### Cloudflare Tunnel instead of an Ingress controller

If your cluster has no public IP / Ingress controller, `cloudflared` (an
outbound-only tunnel client) is a good alternative - no LoadBalancer or
open inbound ports needed:

1. In the Cloudflare Zero Trust dashboard: **Networks -> Tunnels -> Create
   a tunnel**, choose the "Cloudflared" connector type, and give it a name.
2. Copy the token from the install command it shows you (the string after
   `--token`) into the `CLOUDFLARE_TUNNEL_TOKEN` GitHub secret.
3. On the same screen (or **Public Hostname** tab afterwards), add a
   public hostname for each service you want reachable, pointing at the
   in-cluster Service DNS name over plain HTTP - e.g.:
   - `nexa.yourdomain.com` -> `http://portal:3000`
   - `api.nexa.yourdomain.com` -> `http://kong:8000`
   - `analytics.nexa.yourdomain.com` -> `http://metabase:3000`

   These are internal cluster DNS names, only reachable from inside the
   cluster - that's expected, `cloudflared` is what bridges them out.
4. Set `NEXA_CLOUDFLARED_ENABLED=true`, `NEXA_INGRESS_ENABLED=false`, and
   `NEXA_TLS_TERMINATED_EXTERNALLY=true` (Cloudflare terminates TLS for
   you) as repo variables, or pass them as inputs on a manual run.

### Optional: gate deploys behind manual approval

`deploy.yml`'s deploy job runs under the `production` GitHub Environment.
Add protection rules to it (**Settings -> Environments -> production ->
Required reviewers**) to require a manual approval click before every
deploy, without changing the workflow itself.
