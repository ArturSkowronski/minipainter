FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY data ./data

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV WARPAINT_INVENTORY_PATH=/data/inventory.json

EXPOSE 8080

CMD ["node", "src/mcp-http-server.mjs"]
