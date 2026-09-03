# Stage 1: Build
FROM node:22-bookworm-slim AS builder

# Set the working directory to the monorepo root
WORKDIR /app

# Copy the shared contract library first (required by tsconfig)
COPY libs/ /app/libs/

# Copy the server package files
COPY server/package.json server/package-lock.json ./server/

WORKDIR /app/server

# Install all dependencies (including devDependencies needed for tsc)
RUN npm ci

# Copy the rest of the server source code
COPY server/ ./

# Build the TypeScript code
RUN npm run build

# Remove devDependencies to keep the final image clean
RUN npm prune --omit=dev

# Stage 2: Production Runtime
FROM node:22-bookworm-slim

# Install requested system dependencies (ffmpeg, tini, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the shared libs (in case they are referenced at runtime)
COPY --from=builder /app/libs /app/libs

# Copy the built server code and pruned node_modules
COPY --from=builder /app/server /app/server

WORKDIR /app/server

# Expose HTTP and WSS ports
EXPOSE 3000
EXPOSE 3001

# Use tini to handle kernel signals and prevent zombie processes
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start the main API/WebSocket server
CMD ["npm", "start"]
