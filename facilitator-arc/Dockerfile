FROM node:25-alpine AS workspace
WORKDIR /app
RUN npm install --global npm@11.11.1
COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/package.json
COPY facilitator/package.json ./facilitator/package.json
COPY facilitator-arc/package.json ./facilitator-arc/package.json
COPY resource-server/package.json ./resource-server/package.json

FROM workspace AS build
RUN --mount=type=cache,id=agentpay-npm,target=/root/.npm,sharing=locked \
    npm ci --workspace=@agentpay/arc-facilitator --include-workspace-root=false \
    --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY facilitator-arc ./facilitator-arc
RUN npm run build --workspace=@agentpay/arc-facilitator
RUN npm prune --omit=dev --workspace=@agentpay/arc-facilitator --include-workspace-root=false

FROM node:25-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/facilitator-arc/dist ./facilitator-arc/dist
COPY facilitator-arc/package.json ./facilitator-arc/package.json
USER node
WORKDIR /app/facilitator-arc
EXPOSE 8788
CMD ["node", "dist/index.js"]
