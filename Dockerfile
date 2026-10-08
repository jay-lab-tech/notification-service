FROM node:24-bookworm

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN DATABASE_URL=postgresql://postgres:postgres@localhost:5432/notification_service npm run db:generate \
    && npm run build

ENV NODE_ENV=production
EXPOSE 3003
CMD ["sh", "-c", "npm run db:deploy && npm start"]
