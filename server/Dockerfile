# Opción B si Nixpacks falla: en Railway → Settings → usar Dockerfile como builder.
FROM node:20-bookworm-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate && npm run build

ENV NODE_ENV=production

EXPOSE 3002

# El schema lo aplica `releaseCommand` de railway.toml (evita duplicar db push).
CMD ["npm", "run", "start"]
