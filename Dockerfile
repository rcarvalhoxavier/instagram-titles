FROM node:24-slim

WORKDIR /app
# package-lock.json goes in too: `npm ci` requires it, and it is what makes the
# image reproducible instead of "whatever the registry served that minute".
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

USER node
ENTRYPOINT ["node", "src/main.ts"]
