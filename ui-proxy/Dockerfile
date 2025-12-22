FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN addgroup -g 1001 -S nodejs && \
    adduser -S proxyuser -u 1001 -G nodejs && \
    chown -R proxyuser:nodejs /app

USER proxyuser

EXPOSE 8008

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8008/api/health || exit 1

CMD ["npm", "run", "start"]
