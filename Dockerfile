# --- Stage 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./

# Install all dependencies (including devDependencies like typescript)
# --no-audit and --no-fund reduce memory and network overhead
RUN npm ci --no-audit --no-fund

COPY . .

# This generates the compiled JS in the /app/dist folder
RUN npm run build

# --- Stage 2: Production ---
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# Install only production dependencies
RUN npm ci --omit=dev --no-audit --no-fund

# Copy only the compiled code from the builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.js"]