.PHONY: up down clean health hash dev-up dev-down dev-logs

# Production
up:
	docker compose up -d --build

down:
	docker compose down

# Development (with mock mode)
dev-up:
	docker compose -f compose.development.yml up -d --build

dev-down:
	docker compose -f compose.development.yml down

dev-logs:
	docker compose -f compose.development.yml logs -f

# Utilities
clean:
	docker compose down -v
	docker compose -f compose.development.yml down -v 2>/dev/null || true
	rm -rf furnel-db-data temporal-db-data

health:
	@docker compose ps

hash:
	@read -p "Enter password: " pwd && \
	docker run --rm caddy:2-alpine caddy hash-password --plaintext "$$pwd"
