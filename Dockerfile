# PCB Checker & CAM — self-hosted image (Node server)
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* bunfig.toml* ./
RUN bun install
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SELF_HOSTED=true \
    NITRO_PRESET=node-server
RUN bun run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV PORT=3000 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
