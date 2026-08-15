export default defineEventHandler((event) => proxyStudioShellRequest(event, useRuntimeConfig().studioInternalUrl));
