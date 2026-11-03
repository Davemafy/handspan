# Keep this tag identical to the playwright package version in package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/
RUN chown -R pwuser:pwuser /app
USER pwuser
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
