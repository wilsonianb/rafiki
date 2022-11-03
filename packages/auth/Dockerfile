FROM node:18-slim as builder

WORKDIR /workspace

RUN apt update
RUN apt install -y curl xz-utils python3 build-essential

RUN corepack enable
RUN corepack prepare pnpm@7.14.2 --activate

# pnpm fetch does require only lockfile
COPY pnpm-lock.yaml ./
RUN pnpm fetch

ADD . ./
RUN pnpm install -r --offline

RUN pnpm --filter auth build

CMD ["node", "./packages/auth/dist/index.js"]
