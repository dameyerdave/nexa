export default defineEventHandler((event) => proxyStudioRequest(event, useRuntimeConfig().restInternalUrl));
