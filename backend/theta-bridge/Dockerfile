# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies for native modules and WebSocket support
RUN apk add --no-cache python3 make g++ git

# Copy package files
COPY package*.json ./

# Install dependencies (including ws for WebSocket)
RUN npm ci --only=production

# Install ws explicitly if not in package.json
RUN npm install ws

# Copy application code
COPY src/ ./src/
COPY abis/ ./abis/
COPY circuits/ ./circuits/

# Create logs directory
RUN mkdir -p logs

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3001

# Health check (includes reverse-burn stats)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Start the service
CMD ["node", "src/index.js"]

