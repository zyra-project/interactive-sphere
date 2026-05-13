FROM node:22-bookworm-slim

WORKDIR /app

# System dependencies for Tauri (build + WebKitGTK)
# Reference: https://v2.tauri.app/start/prerequisites/#linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    git-lfs \
    bash \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain (needed to compile the Tauri app itself)
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal \
    && rustc --version && cargo --version

# Install Tauri CLI via npm (fast — avoids cargo install compile)
RUN npm install -g @tauri-apps/cli@latest && tauri --version

# Install Node dependencies (cached layer)
# --ignore-scripts skips postinstall; we run tokens/locales after source is copied
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and config
COPY tsconfig.json vite.config.ts ./
COPY tokens/ ./tokens/
COPY locales/ ./locales/
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY public/ ./public/

# Run the build steps that were previously in postinstall
RUN npm run tokens && npm run locales

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]