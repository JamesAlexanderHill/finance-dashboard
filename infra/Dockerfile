FROM oven/bun:1.4.3 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/parsers/package.json packages/parsers/package.json
COPY packages/imports/package.json packages/imports/package.json
COPY packages/ledger/package.json packages/ledger/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile
COPY . .

FROM base AS web
WORKDIR /app/apps/web
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "start"]

FROM base AS worker
WORKDIR /app/apps/worker
CMD ["bun", "run", "start"]
