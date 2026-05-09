# Build stage
FROM rust:1.80-slim AS builder

WORKDIR /app

# Install dependencies for building
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY crates/we-server/Cargo.toml crates/we-server/
COPY crates/we-core/Cargo.toml crates/we-core/
COPY crates/we-render/Cargo.toml crates/we-render/
COPY crates/we-io/Cargo.toml crates/we-io/
COPY crates/we-service/Cargo.toml crates/we-service/
COPY crates/we-native/Cargo.toml crates/we-native/
COPY crates/we-wasm/Cargo.toml crates/we-wasm/

# Build dependencies only (caching)
RUN mkdir -p crates/we-server/src && \
    echo "fn main() {}" > crates/we-server/src/main.rs && \
    echo "" > crates/we-server/src/lib.rs && \
    cargo build --release --workspace

# Copy source code
COPY . .

# Build the server
RUN cargo build --release --package we-server

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary
COPY --from=builder /app/target/release/we-server /app/we-server

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 3000

# Set environment variables
ENV RUST_LOG=info
ENV DATABASE_URL=postgres://postgres:postgres@db:5432/worldeditor
ENV JWT_SECRET=your-secret-change-in-production

# Run migrations and start server
CMD ["./we-server"]