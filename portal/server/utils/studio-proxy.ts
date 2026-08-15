import type { H3Event } from "h3";

const HOP_BY_HOP_REQUEST_HEADERS = new Set(["host", "content-length", "connection"]);
const HOP_BY_HOP_RESPONSE_HEADERS = new Set(["content-encoding", "transfer-encoding", "connection"]);

function checkProxySecret(event: H3Event): void {
  const config = useRuntimeConfig();
  const proxySecret = getHeader(event, "x-kong-proxy-secret");
  if (!proxySecret || proxySecret !== config.serviceRoleKey) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }
}

/** Forwards a request byte-for-byte to targetBaseUrl, optionally adding
 * extra headers first (e.g. X-User-Email). Shared by both proxy functions
 * below - only the auth check and what gets stamped onto the request
 * differs between them. */
async function forwardRequest(event: H3Event, targetBaseUrl: string, extraHeaders: Record<string, string> = {}) {
  const subPath = getRouterParam(event, "path") ?? "";
  const search = getRequestURL(event).search;
  const targetUrl = `${targetBaseUrl.replace(/\/$/, "")}/${subPath}${search}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(getHeaders(event))) {
    if (!value || HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === "x-kong-proxy-secret") {
      continue;
    }
    headers[key] = value;
  }
  Object.assign(headers, extraHeaders);

  const method = event.node.req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readRawBody(event) : undefined;

  const upstream = await fetch(targetUrl, { method, headers, body });

  setResponseStatus(event, upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) setResponseHeader(event, key, value);
  });

  await send(event, Buffer.from(await upstream.arrayBuffer()));
}

/** Proxies a request from Studio (reached through Kong's `meta`/`rest-v1`
 * routes - see volumes/api/kong.yml) to the real internal service
 * (pg-meta or PostgREST), stamping the caller's Metabase identity onto it
 * as an X-User-Email header along the way, so the audit trigger (see
 * volumes/db/audit.sql) can attribute the resulting row change to a real
 * person instead of the shared credentials every Studio user shares.
 *
 * Only reachable via Kong: guarded by a shared secret Kong injects (see
 * kong.yml's request-transformer on these routes) so hitting the portal's
 * own published port directly can't bypass Kong's key-auth/acl checks on
 * these routes. */
export async function proxyStudioRequest(event: H3Event, targetBaseUrl: string): Promise<void> {
  checkProxySecret(event);

  const token = getCookie(event, METABASE_COOKIE);
  const email = token ? await resolveEmailForSession(token) : null;

  await forwardRequest(event, targetBaseUrl, email ? { "x-user-email": email } : {});
}

/** Confirmed live (curl'd the actual response) that Studio's own frontend
 * calls these paths - some on a recurring background timer, not just page
 * load - without the browser's session cookie attached at all (not a
 * caching/race issue like the burst-of-parallel-requests bug fixed
 * earlier - these fail every single time, consistently). Both are
 * genuinely non-sensitive: a version string and a static PWA manifest,
 * nothing that touches data or the embedded service_role key. Gating them
 * anyway just breaks Studio's own polling with no real security benefit,
 * so they're exempted from the editor check below - everything else,
 * including the root page (where the service_role key actually gets
 * embedded), still requires it. */
const SHELL_PUBLIC_PATHS = [/^api\/get-deployment-commit$/, /^favicon\//];

/** Proxies a request to Studio's own shell (Kong's `dashboard` route) -
 * unlike proxyStudioRequest above, this one requires the caller to
 * actually be an editor, not just signed in (except SHELL_PUBLIC_PATHS
 * above). Studio's frontend bundle embeds the service_role key (needed
 * for its own calls to PostgREST/pg-meta), so anyone who can load the
 * shell at all gets full database access regardless of what they click
 * on - this is the only thing standing between "signed in" and "full
 * admin over the database" now that Kong's Basic Auth in front of Studio
 * is gone (embedded credentials in an iframe src turned out to be
 * blocked outright by modern browsers - confirmed live, see kong.yml's
 * `dashboard` route). */
export async function proxyStudioShellRequest(event: H3Event, targetBaseUrl: string): Promise<void> {
  checkProxySecret(event);

  const subPath = getRouterParam(event, "path") ?? "";
  if (!SHELL_PUBLIC_PATHS.some((re) => re.test(subPath))) {
    const token = getCookie(event, METABASE_COOKIE);
    const isEditor = token ? await resolveIsEditorForSession(token) : false;
    if (!isEditor) {
      throw createError({ statusCode: 403, statusMessage: "Editor access required" });
    }
  }

  await forwardRequest(event, targetBaseUrl);
}
