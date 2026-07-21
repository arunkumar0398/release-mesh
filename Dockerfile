FROM node:22-bookworm-slim

WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile
