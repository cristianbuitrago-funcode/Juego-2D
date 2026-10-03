# Imagen del servidor de juego (Cloud Run, Fly.io, Railway, cualquier hosting con Docker).
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Cloud Run inyecta PORT (8080 por defecto).
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
