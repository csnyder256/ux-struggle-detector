FROM node:22-bookworm-slim AS build
LABEL org.opencontainers.image.source="https://github.com/csnyder256/ux-struggle-detector"
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build AUTH_SECRET=build-placeholder-not-for-runtime KEY_ENCRYPTION_KEY=build-placeholder-not-for-runtime
RUN pnpm exec prisma generate && pnpm sdk:build && pnpm sdk:build:min && pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json /app/next.config.mjs ./
RUN node node_modules/playwright/cli.js install --with-deps chromium
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(r.status>=500)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
