FROM golang:1.26-alpine3.23 AS build
RUN apk add --no-cache gcc musl-dev sqlite-dev
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/orbia ./cmd/orbia

FROM alpine:3.23
RUN apk add --no-cache sqlite-libs ca-certificates \
    && addgroup -g 10001 orbia && adduser -D -H -u 10001 -G orbia orbia \
    && mkdir -p /data && chown orbia:orbia /data
COPY --from=build /out/orbia /app/orbia
USER 10001:10001
ENV ORBIA_ADDR=:8726 ORBIA_DB=/data/orbia.db
EXPOSE 8726
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8726/healthz || exit 1
ENTRYPOINT ["/app/orbia"]
