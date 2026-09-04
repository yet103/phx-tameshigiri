FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
RUN mkdir -p server/data && chown -R node:node server/data
USER node
EXPOSE 3457
CMD ["npm", "start"]
