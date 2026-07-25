FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
EXPOSE 3200
CMD ["node", "--import", "tsx", "src/index.ts"]