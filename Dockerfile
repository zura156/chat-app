# Build Angular App
FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
# `npm ci` installs exactly what the lockfile pins, and fails loudly if
# package.json and the lockfile have drifted. `npm install --legacy-peer-deps`
# did neither: it could resolve a different dependency tree on every build and
# silently suppressed peer-dependency conflicts rather than surfacing them.
RUN npm ci

COPY . .

RUN npm run build -- --configuration=production

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Remove default Nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy the custom Nginx configuration
# Make sure the filename is exactly nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Included by every location block in nginx.conf — see the note there about
# add_header not inheriting.
COPY security-headers.conf /etc/nginx/conf.d/security-headers.conf

# Copy the build output from the build stage
# NOTE: Based on your angular.json, the path is dist/chat-app/browser
COPY --from=build /app/dist/chat-app/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
