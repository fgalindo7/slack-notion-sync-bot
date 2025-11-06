FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Copy manifest + lockfile first for better layer caching
COPY package.json package-lock.json ./

# Install prod deps only (npm v9+ uses --omit=dev)
RUN npm ci --omit=dev

# Copy the app
COPY app.js ./

# (optional) expose a health port only if you added a health endpoint
# EXPOSE 1987

# Safer non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

ENV PORT=1987
CMD ["node", "app.js"]