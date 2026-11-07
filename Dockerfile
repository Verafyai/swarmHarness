# Verafy Harness: one harness daemon. Zero npm dependencies, so the image is
# Node 22 plus this repo. Configure with VERAFY_* variables (see
# packages/deploy/src/config.js); the identity key and open commitments live
# in /data, so mount a volume there to keep them across restarts.
#
#   docker run -d --env-file ~/.verafy/env -p 7200:7200 -v verafy-data:/data ghcr.io/verafyai/verafy-harness
FROM node:22-slim
WORKDIR /opt/verafy-harness
COPY package.json verafy.config.json ./
COPY bin ./bin
COPY packages ./packages
COPY examples ./examples
RUN rm -rf packages/tinysvm/engine packages/tinysvm/programs packages/solana/program \
 && useradd --system --create-home --home-dir /data verafy && chown -R verafy /data
USER verafy
ENV VERAFY_DATA_DIR=/data VERAFY_PORT=7200 NODE_ENV=production
VOLUME /data
EXPOSE 7200
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.VERAFY_PORT||7200)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "bin/verafy.js"]
CMD ["harness", "serve"]
