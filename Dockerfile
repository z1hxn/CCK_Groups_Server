FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install && \
    npm cache clean --force

# Copy application source code
COPY src ./src

# Expose the port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
