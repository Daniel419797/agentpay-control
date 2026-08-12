FROM node:22-alpine AS workspace
WORKDIR /app
RUN npm install --global npm@11.11.1
COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/package.json
COPY facilitator/package.json ./facilitator/package.json
COPY facilitator-arc/package.json ./facilitator-arc/package.json
COPY facilitator-combined/package.json ./facilitator-combined/package.json
COPY resource-server/package.json ./resource-server/package.json

FROM workspace AS build
RUN --mount=type=cache,id=agentpay-npm,target=/root/.npm,sharing=locked \
    npm ci --workspace=@agentpay/resource-server --include-workspace-root=false \
    --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY resource-server ./resource-server
RUN npm run build --workspace=@agentpay/resource-server
RUN npm prune --omit=dev --workspace=@agentpay/resource-server --include-workspace-root=false

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/resource-server/dist ./resource-server/dist
COPY resource-server/package.json ./resource-server/package.json
USER node
WORKDIR /app/resource-server
EXPOSE 3200
CMD ["npm", "start"]
