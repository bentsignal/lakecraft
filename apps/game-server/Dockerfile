FROM oven/bun:1.3.3-alpine@sha256:d2bc1fbc3afcd3d70afc2bb2544235bf559caae2a3084e9abed126e233797511

WORKDIR /app/apps/game-server

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/data

COPY apps/game-server/src ./src
COPY shared /app/shared

# Railway volumes are mounted root-owned. Railway may also set
# RAILWAY_RUN_UID=0 from the template; keeping the image user explicit makes
# the /data contract work in Railway and ordinary Docker without a chown shim.
USER root

EXPOSE 3001
STOPSIGNAL SIGTERM
ENTRYPOINT ["bun", "run", "src/index.ts"]
