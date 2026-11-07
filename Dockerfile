# syntax=docker/dockerfile:1
FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS api-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --no-audit --no-fund
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS api
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
COPY --from=api-build /app/node_modules ./node_modules
COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY --from=api-build /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations
COPY docker/api-start.cjs docker/api-health.cjs ./docker/
# No package manager or build tooling is required by the runtime/maintenance commands.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER 1000:1000
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD ["node", "docker/api-health.cjs"]
CMD ["node", "docker/api-start.cjs", "serve"]

# Maintained static source includes runtime-loaded sprite assets. Never replace it with a verifier output.
FROM nginx:1.30.6-alpine-slim@sha256:dede8895648b461178c3bc604f7eed4423efe5220b2c4d839f5eb3d34ac3f8f7 AS web
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/web-start.sh docker/web-check.sh /opt/elyqreth/
COPY dist/ /usr/share/nginx/html/
USER 101:101
EXPOSE 8080
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD /bin/sh /opt/elyqreth/web-check.sh live && wget -q -O /dev/null http://127.0.0.1:8080/health
ENTRYPOINT ["/bin/sh", "/opt/elyqreth/web-start.sh"]

# Single TLS edge; never contains application credentials or certificate material.
FROM nginx:1.30.6-alpine-slim@sha256:dede8895648b461178c3bc604f7eed4423efe5220b2c4d839f5eb3d34ac3f8f7 AS edge
COPY docker/edge /opt/elyqreth/edge/
USER 101:101
EXPOSE 8080 8443
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8081/health
ENTRYPOINT ["/bin/sh", "/opt/elyqreth/edge/start.sh"]
