FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN addgroup -g 1001 -S nodejs && \
    adduser -S workeruser -u 1001 -G nodejs && \
    chown -R workeruser:nodejs /app

USER workeruser

CMD ["npm", "run", "start"]
