import type { H3Event } from "h3";

const HOP_BY_HOP_REQUEST_HEADERS = new Set(["host", "content-length", "connection"]);
const HOP_BY_HOP_RESPONSE_HEADERS = new Set(["content-encoding", "transfer-encoding", "connection"]);

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
  const config = useRuntimeConfig();
  const proxySecret = getHeader(event, "x-kong-proxy-secret");
  if (!proxySecret || proxySecret !== config.serviceRoleKey) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const subPath = getRouterParam(event, "path") ?? "";
  const search = getRequestURL(event).search;
  const targetUrl = `${targetBaseUrl.replace(/\/$/, "")}/${subPath}${search}`;

  const token = getCookie(event, METABASE_COOKIE);
  const email = token ? await resolveEmailForSession(token) : null;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(getHeaders(event))) {
    if (!value || HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === "x-kong-proxy-secret") {
      continue;
    }
    headers[key] = value;
  }
  if (email) headers["x-user-email"] = email;

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
