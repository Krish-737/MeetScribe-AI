# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Expose port and start dev server
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
