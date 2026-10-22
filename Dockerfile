# Frontend build stage: Vite and TypeScript are dev dependencies, so the
# production install below cannot produce the bundle on its own.
FROM node:24-alpine AS frontend

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache font-liberation

# Same /data contract as the GHCR image: the generated setup key must survive a
# container recreate. Home/dev run as root, but a named volume should still be
# seeded with the runtime user's ownership for parity.
RUN mkdir -p /data && chown node:node /data

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
# Built SPA bundle (served by Express at /app).
COPY --from=frontend /frontend/dist ./frontend/dist

EXPOSE 7860
ENV PORT=7860

CMD ["npm", "start"]
