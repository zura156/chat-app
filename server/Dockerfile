FROM node:24-slim AS builder

WORKDIR /app

# Copy the shared library and server source code maintaining the root relative structure
COPY libs/contract/ ./libs/contract/
COPY server/ ./server/

# Install dependencies and build from the server directory
WORKDIR /app/server
RUN NODE_ENV=development npm ci
RUN npm run build
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:24-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg tini curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./

RUN mkdir -p /app/logs && chown -R node:node /app

ARG PORT=3000
ARG WS_PORT=3001
ENV NODE_ENV=production
ENV PORT=$PORT
ENV WS_PORT=$WS_PORT

USER node

EXPOSE $PORT $WS_PORT

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health-check').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/index.js"]
