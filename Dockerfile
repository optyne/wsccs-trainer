FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8080 DATA_DIR=/app/data UPLOAD_DIR=/app/uploads
VOLUME ["/app/data", "/app/uploads"]
EXPOSE 8080
CMD ["node", "server.js"]
