.PHONY: up down clean health hash

up:
	docker compose up -d --build

down:
	docker compose down

clean:
	docker compose down -v
	rm -rf postgres-data temporal-data caddy_data caddy_config

health:
	@docker compose ps

hash:
	@read -p "Enter password: " pwd && \
	docker run --rm caddy:2-alpine caddy hash-password --plaintext "$$pwd"
