.PHONY: build run test check e2e
build:
	CGO_ENABLED=1 go build -trimpath -o orbia ./cmd/orbia
run:
	go run ./cmd/orbia
test:
	go test -race ./...
check:
	go vet ./...
	npm run check
e2e:
	npm run test:e2e
