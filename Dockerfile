# Build Angular App
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build -- --configuration=production

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Remove default Nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy the custom Nginx configuration
# Make sure the filename is exactly nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the build output from the build stage
# NOTE: Based on your angular.json, the path is dist/chat-app/browser
COPY --from=build /app/dist/chat-app/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]