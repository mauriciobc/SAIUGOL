# Use Node.js 18 Alpine as the base image (minimal footprint)
# Alpine images are compatible with ARM32/v7 architectures
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy app source (respecting .dockerignore)
COPY src/ ./src/

# Use a non-root user for security
USER node

# Start the bot
CMD ["npm", "start"]
