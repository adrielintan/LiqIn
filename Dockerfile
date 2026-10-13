FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY index.html app.js styles.css favicon.png ./
RUN mkdir -p public && cp index.html app.js styles.css favicon.png public/

RUN mkdir -p /var/lib/liqin/uploads
EXPOSE 3000
CMD ["node", "dist/server.js"]
