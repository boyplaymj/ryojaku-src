# Build stage
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Copy go.mod and go.sum
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the specific lambda
ARG PROJECT_PATH
ARG GOARCH=amd64
# Build with optimizations (-s -w) to reduce binary size
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${GOARCH} go build -tags lambda.norpc -ldflags="-s -w" -o /main ./${PROJECT_PATH}

# Run stage - using alpine for better debugging and standard path
FROM alpine:latest

# Install CA certificates and timezone data
RUN apk add --no-cache ca-certificates tzdata

# Create /var/task directory
WORKDIR /var/task

# Copy the binary to /var/task/bootstrap
COPY --from=builder /main /var/task/bootstrap

# Ensure it is executable
RUN chmod +x /var/task/bootstrap

# Set the entrypoint
ENTRYPOINT [ "/var/task/bootstrap" ]
