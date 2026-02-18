FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    libstdc++6 \
    zlib1g \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY requirements.txt ./
RUN python3 -m pip install -r requirements.txt --break-system-packages

COPY . .
RUN npm run build

ENV PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

EXPOSE 5000
CMD ["node", "dist/index.js"]
