# Use official Bun image
FROM oven/bun:1.2.21-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Build both backend and frontend
RUN bun run build

# Expose the server port
EXPOSE 3000

# Set environment variables for Render compatibility
ENV PORT=3000
ENV NODE_ENV=production

# Start using the custom server script
CMD ["bun", "run", "start"]
