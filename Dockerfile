# Single-container deploy (Fly.io, Railway, Render Docker, etc.): server + built client on one port.
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --include=dev && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app /app
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
