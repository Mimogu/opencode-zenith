---
name: docker-infra
description: "MANDATORY: Autonomously activate whenever creating, optimizing, or debugging Dockerfiles, docker-compose.yml files, or container infrastructure. Enforces multi-stage builds, non-root users, layer caching, and health checks. Trigger automatically on container tasks; never wait for user to request."
---

# Docker & Container Infrastructure Protocol

Ensures all generated Dockerfiles and compose setups are production-hardened, fast-building, lightweight, and secure.

## Hardening Standards

1. **Multi-Stage Builds**:
   - Stage 1 (Builder): Install full build tools, devDependencies, and compile.
   - Stage 2 (Runner): Copy only compiled artifacts and production dependencies. Never ship compilers or test tools in production images.
2. **Layer Caching Optimization**:
   - Copy dependency manifests first (`package.json`, `pnpm-lock.yaml`, `requirements.txt`, `go.mod`), install dependencies, and ONLY THEN copy application source.
3. **Non-Root Execution**:
   - Always run as an unprivileged user: `USER node` / `USER appuser`.
4. **Minimal Base Images**:
   - Prefer `alpine`, `distroless`, or `-slim` Debian variants.

## Example Multi-Stage Dockerfile (Node/Bun)

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

## Compose Best Practices
- Define explicit health checks (`healthcheck: test: ["CMD", "curl", "-f", "..."]`).
- Avoid exposing database ports directly to `0.0.0.0` unless intentionally public.
- Declare named volumes for persistent data.
