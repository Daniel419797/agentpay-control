FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 8788
CMD ["node", "--import", "tsx", "src/index.ts"]
