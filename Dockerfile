# --- BUILD ---
FROM node:18 AS builder

WORKDIR /app/

ADD package.json package-lock.json ./
RUN npm install

ADD ./src/ ./src/
ADD ./tsconfig.json ./
RUN npm run build

CMD [ "npm", "run", "start" ]