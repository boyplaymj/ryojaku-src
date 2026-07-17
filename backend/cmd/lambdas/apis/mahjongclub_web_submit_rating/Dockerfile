FROM public.ecr.aws/docker/library/golang:1.22-alpine AS builder
RUN apk add --no-cache git ca-certificates file
WORKDIR /app
COPY ../../.. .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o bootstrap ./cmd/lambdas/apis/mahjongclub_web_submit_rating
RUN ls -la bootstrap && file bootstrap

FROM public.ecr.aws/docker/library/alpine:3.18
RUN apk add --no-cache imagemagick ca-certificates tzdata
COPY --from=builder /app/bootstrap /bootstrap
ENTRYPOINT [ "/bootstrap" ]
