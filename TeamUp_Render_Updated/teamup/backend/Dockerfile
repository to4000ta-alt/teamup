FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY db/init.sql ./db/init.sql
ENV DB_SCHEMA_PATH=/app/db/init.sql
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
