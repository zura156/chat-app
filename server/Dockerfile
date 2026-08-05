FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN NODE_ENV=development npm ci

COPY . .
RUN npm run build

# Production dependencies only, resolved after the build. The runtime image
# used to copy the *build* node_modules wholesale, so it shipped TypeScript,
# eslint, nodemon, ts-node and every @types package into production.
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:22-slim AS runner

# tini as PID 1. Node neither reaps zombies nor gets default signal handling
# when it is PID 1, so anything it spawns (ffmpeg) could linger after a stop.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# The logger writes under the working directory; the node user must own it.
RUN mkdir -p /app/logs && chown -R node:node /app

ENV NODE_ENV=production

# Not root. The image ran as root, so a compromise of the process was a
# compromise of the container.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health-check').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/index.js"]
