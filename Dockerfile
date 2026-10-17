FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --include=dev
COPY playwright.config.ts playwright.review.config.ts ./
COPY scripts scripts
COPY client client
COPY server server
RUN npm run build:production
ENV NODE_ENV=production
USER node
CMD ["node", "server/dist/src/index.js"]
