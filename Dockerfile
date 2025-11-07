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

# (optional) expose a health port only if you added a health endpoint
# EXPOSE 1987

# Safer non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

ENV PORT=1987
CMD ["node", "app.js"]