FROM node:20-alpine

WORKDIR /app

# Copy package info
COPY package.json ./

# Copy server and public frontend files
COPY server/ ./server/
COPY public/ ./public/

# Environment defaults
ENV PORT=3300
ENV CARS_FILE=/app/data/cars.json

# Create volume mount points
RUN mkdir -p /app/data

EXPOSE 3300

CMD ["node", "server/index.js"]
