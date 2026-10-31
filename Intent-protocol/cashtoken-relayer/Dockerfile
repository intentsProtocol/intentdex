# The cashtoken relayer as a container, for Railway or any host that runs one.
#
# The code lives in /app. The process runs from /data, because the relayer writes its state (intents.json,
# profit-ledger.json) to the directory it is started in: mount a volume at /data and the open orders survive a
# redeploy. Without a volume the state is lost on every restart, and with it the record of orders that still
# hold a maker's funds.

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# Dev dependencies are kept: the relayer is started with tsx, which is one of them.
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./

RUN mkdir -p /data
WORKDIR /data

ENV NODE_ENV=production
EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3005)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/node_modules/.bin/tsx", "/app/src/index.ts"]
