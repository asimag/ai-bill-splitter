# API image. Runs pending migrations at startup, then serves the API.
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache wget
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts && npm cache clean --force
COPY packages ./packages
COPY apps/server ./apps/server
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "run", "-w", "@billsplit/server", "start"]
