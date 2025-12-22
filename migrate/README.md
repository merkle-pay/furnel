# Database Migrations

PostgreSQL database migrations for Furnel using [node-pg-migrate](https://github.com/salsita/node-pg-migrate).

## Quick Start

### Using Docker Compose (recommended)

```bash
# From project root
docker compose -f compose.development.yml up migrate
```

### Local Development

```bash
cd migrate
npm install
DATABASE_URL=postgres://furnel:devpassword@localhost:5432/furnel npm run migrate:up
```

## Commands

```bash
# Run pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Create new migration
npm run create my-migration-name
```

## Migration Format

Migrations use SQL with comment-based separators:

```sql
-- Up Migration
CREATE TABLE payments (
    id VARCHAR(255) PRIMARY KEY,
    amount DECIMAL(18, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Down Migration
DROP TABLE payments;
```

## Directory Structure

```
migrate/
├── migrations/           # SQL migration files
├── migrations.json       # node-pg-migrate config
├── package.json
├── Dockerfile
└── README.md
```

## Configuration

See `migrations.json`:

```json
{
  "database-url": "DATABASE_URL",
  "migrations-dir": "migrations",
  "migrations-table": "pgmigrations",
  "migration-file-language": "sql"
}
```

## Best Practices

1. **Always write down migrations** - Enable safe rollbacks
2. **Use `IF EXISTS` / `IF NOT EXISTS`** - Make migrations idempotent
3. **Reverse order in down migrations** - Drop constraints before tables

## Troubleshooting

Check migration status:

```sql
SELECT * FROM pgmigrations ORDER BY run_on DESC;
```

Rollback:

```bash
docker compose -f compose.development.yml run --rm migrate \
  npx node-pg-migrate down --config-file migrations.json
```
