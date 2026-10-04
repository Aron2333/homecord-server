FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 10000

ENV NODE_ENV=production
ENV PORT=10000

CMD ["npm", "run", "start"]
