.PHONY: stop down up logs build restart stats workers api health

stop:
	docker compose stop

down:
	docker compose down

up:
	docker compose up -d

logs:
	docker compose logs -f

build:
	docker compose build --no-cache

restart:
	docker compose restart

prune:
	docker system prune -a

stats:
	docker stats --no-stream

workers:
	docker compose build workers --no-cache && \
	docker compose up -d workers

api:
	docker compose build api --no-cache && \
	docker compose up -d api

health:
	@echo "=== Payment Services Health Check ==="
	@docker compose ps --format "table {{.Name}}\t{{.Status}}"

temporal-cli:
	docker compose exec temporal-admin-tools bash

db:
	docker compose exec postgres psql -U payment -d payment_db
