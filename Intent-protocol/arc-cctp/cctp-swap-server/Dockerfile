# cctp-swap-server — production image (Node 20, tsx runtime, same pattern as bsc-bch-server)
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/          src/
COPY tsconfig.json ./

# Mount a Railway volume at /app/data so transfer state survives redeploys.
RUN mkdir -p data

ENV NODE_ENV=production
EXPOSE 3012

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3012)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
