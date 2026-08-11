#
# Builds a documentation site from a content folder. Copy this into your own
# repository — it needs nothing from Zellij's source, only the public base
# image.
#
#   docker build -f site.Dockerfile --build-arg CONTENT=docs -t my-docs .
#   docker run --rm -p 3000:3000 my-docs
#
# For documentation with formulas or diagrams in it:
#
#   docker build -f site.Dockerfile --build-arg FEATURES=all ...
#
# To build against a base image you built yourself:
#
#   docker build -f site.Dockerfile \
#     --build-arg ZELLIJ_IMAGE=zellij-base --build-arg ZELLIJ_VERSION=test ...
#
# The engine never reaches the image you deploy: the build stage is discarded
# and only the compiled site survives into the runtime stage.

# The base image, overridable so it can be pulled from a mirror, or pointed at
# a locally built one while working on the image itself.
ARG ZELLIJ_IMAGE=ghcr.io/mylife-inc/zellij-base
ARG ZELLIJ_VERSION=latest
ARG CONTENT=content

# Optional engine features: maths, diagrams, all, or empty for neither.
#
# The published image variants have these baked in, and this is the other way
# to the same place: take the plain image and ask for what this site needs, at
# the moment it is built. Nothing is installed in the base image, so turning a
# feature on here costs no more than having pulled the variant that had it.
ARG FEATURES=

# ------------------------------------------------------------------- build
FROM ${ZELLIJ_IMAGE}:${ZELLIJ_VERSION} AS build

ARG CONTENT
WORKDIR /app

# Replace the placeholder content wholesale. `rm` first so a file the previous
# content had and yours does not cannot survive into your site.
RUN rm -rf /app/content
COPY ${CONTENT}/ /app/content/

ARG FEATURES

# Before installing, because the point of asking is to change what gets fetched.
RUN if [ -n "$FEATURES" ]; then \
      node /opt/zellij/bin/zellij.mjs features "$FEATURES" /app; \
    fi

# The base image carries the engine and a manifest, and nothing else. This is
# where the manifest becomes an installation — deferred to here because it is
# the first moment the content, and so which optional features it needs, is
# known.
RUN npm install --install-links

# Fails the build on a broken link or an invalid section, naming the file —
# rather than publishing a site with a dead page in it.
RUN npx zellij check content

RUN npm run build


# ----------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Not root. The site serves static files and needs nothing a user cannot do.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

WORKDIR /app

# `standalone` carries its own traced dependencies, so there is no npm install
# here and no node_modules to ship.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
