# node:22-slim (Debian, glibc) rather than an alpine base — bcrypt has a
# native module that needs to compile/link against glibc; alpine's musl
# libc frequently means an extra build-toolchain install just to get the
# same package working. Slim keeps the image reasonably small without
# that friction.
FROM node:22-slim

WORKDIR /app

# Copy just the manifest files first so `npm ci` only re-runs when
# dependencies actually change, not on every source edit — Docker caches
# each instruction as a layer, and this ordering keeps rebuilds fast.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3000

# The default command runs the API server. docker-compose.yml overrides
# this with ["node", "src/worker.js"] for the worker service — same image,
# same dependencies, just a different entry point, so we're not
# maintaining two separate builds for two processes that share one codebase.
CMD ["node", "src/server.js"]
