FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server.js game.js ./
COPY public ./public
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
