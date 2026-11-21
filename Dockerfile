FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server.js game.js ./
COPY public ./public
CMD ["node", "server.js"]
