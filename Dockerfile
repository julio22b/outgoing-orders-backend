FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS development
COPY . .
EXPOSE 3000
CMD ["npx", "nodemon", "-L", "--watch", "src", "--ext", "ts", "--exec", "npx ts-node src/server.ts"]

FROM base AS production
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]