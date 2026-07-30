FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 7860
ENV PORT=7860

CMD ["npm", "start"]
