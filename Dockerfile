FROM node:24-slim

WORKDIR /app
COPY package.json ./
COPY src ./src

USER node
ENTRYPOINT ["node", "src/main.ts"]
