FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install wget for health checks
RUN apk add --no-cache wget

# Copy manifest + lockfile first for better layer caching
COPY package.json package-lock.json ./

# Install prod deps only (npm v9+ uses --omit=dev)
RUN npm ci --omit=dev

# Copy the app and lib modules
COPY app.js ./
COPY lib ./lib

# Copy channel mappings (will be overridden by secret in Cloud Run)
# Channel mappings now injected via secret env var (CHANNEL_MAPPINGS_JSON);
# omit optional file copy to avoid build failures when file excluded.

# (optional) expose a health port only if you added a health endpoint
# EXPOSE 1987

# Safer non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

# Set build timestamp (can be overridden at build time)
ARG BUILD_TIME=unknown
ENV BUILD_TIME=${BUILD_TIME}
ENV PORT=1987
CMD ["node", "app.js"]