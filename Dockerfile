FROM node:22-slim

WORKDIR /app
ENV CI=true

RUN npm install -g pnpm@11.7.0 serve@14.2.4

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

CMD ["sh", "-c", "serve dist --listen tcp://0.0.0.0:${PORT:-4321}"]
