FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN addgroup -g 1001 -S nodejs && \
    adduser -S apiuser -u 1001 -G nodejs && \
    chown -R apiuser:nodejs /app

USER apiuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["npm", "run", "start"]
