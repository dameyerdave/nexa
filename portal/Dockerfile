FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.output ./.output
# The nexa CLI (cli/nexa.mjs) is a standalone script, not part of Nitro's
# bundled server output, so it needs its own deps (otpauth, qrcode-terminal)
# and node_modules on the image - see "nexa admin CLI" in README.md.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/cli ./cli
RUN printf '#!/bin/sh\nexec node /app/cli/nexa.mjs "$@"\n' > /usr/local/bin/nexa && chmod +x /usr/local/bin/nexa
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
