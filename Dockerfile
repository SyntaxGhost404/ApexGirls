FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
ENV DATABASE_PATH=/app/data/sanctuary.db
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
