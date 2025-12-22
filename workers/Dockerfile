# Use slim (Debian-based) not Alpine - Temporal SDK requires glibc
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy everything (Temporal needs src/workflows for bundling)
COPY . .
RUN npm run build

RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs workeruser && \
    chown -R workeruser:nodejs /app

USER workeruser

CMD ["npm", "run", "start"]
