export default defineEventHandler((event) => proxyStudioRequest(event, useRuntimeConfig().pgMetaUrl));
