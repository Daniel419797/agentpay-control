FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY card-executor/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY card-executor/src ./src

# The Playwright base image provides the unprivileged pwuser account. The
# executor never needs root privileges at runtime.
USER pwuser

CMD ["node", "src/index.mjs"]
