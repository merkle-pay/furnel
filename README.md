# Furnel

> **F**iat **U**SDC/USDT **R**emittance Tun**NEL**

Open-source cross-border payment orchestration using stablecoin rails.

```
USDC (Solana) → Local Currency (fiat)
```

## How It Works

1. User has USDC in their Solana wallet
2. User initiates payment with recipient's bank details
3. User sends USDC to Furnel
4. Furnel offramps via Coinbase/Transak
5. Recipient receives local currency in their bank

All orchestrated by [Temporal](https://temporal.io/) with automatic retry, compensation (rollback), and full audit trail.

## Tech Stack

- **Temporal** — Workflow orchestration
- **Hono** — API framework
- **PostgreSQL** — Database
- **Solana** — Blockchain (USDC-SPL)
- **Coinbase/Transak** — Offramp (USDC → local currency)
- **Caddy** — Reverse proxy

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Coinbase/Transak API key (sandbox)

### Setup

```bash
# Clone
git clone https://github.com/your-username/furnel.git
cd furnel

# Configure
cp .env.example .env

# Generate Caddy password hash
make hash

# Edit .env with your values
vim .env

# Start
make up

# Check status
make health
```

### Environment Variables

```bash
# Required
POSTGRES_PASSWORD=your_secure_password
DOMAIN=:80                    # or furnel.yourdomain.com
CADDY_ADMIN_USER=admin
CADDY_ADMIN_HASH=$2a$14$...   # from: make hash
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/payments` | Create new payment |
| `GET` | `/api/payments/:id` | Get payment status |
| `GET` | `/api/health` | Health check |

### Create Payment

```bash
curl -X POST http://localhost/api/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "GBP",
    "recipientId": "user123"
  }'
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Caddy     │────▶│  Hono API   │────▶│  Temporal   │
│  (proxy)    │     │   :3000     │     │   :7233     │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  PostgreSQL │     │   Workers   │
                    │   :5432     │     │             │
                    └─────────────┘     └─────────────┘
                                               │
                                               ▼
                                      ┌───────────────┐
                                      │ Coinbase/     │
                                      │ Transak       │
                                      │ (offramp)     │
                                      └───────────────┘
```

## Workflow States

```
INITIATED
    ↓
WAITING_FOR_USDC → USDC_TIMEOUT
    ↓
USDC_RECEIVED
    ↓
FX_LOCKED
    ↓
OFFRAMPING → OFFRAMP_FAILED → REFUNDED
    ↓
LOCAL_SENT
    ↓
COMPLETED
```

## Development

```bash
make up       # Start services
make down     # Stop services
make health   # Check status
make clean    # Remove all data
make hash     # Generate password hash
```

## Testing

### Sandbox Mode

- Use Coinbase/Transak sandbox APIs
- Use Solana Devnet for USDC
- No real money

### Production Testing

1. Create a [Wise](https://wise.com) account
2. Get local bank details (GBP, EUR, etc.)
3. Test with small amounts
4. Verify funds land in Wise

## Documentation

- [Product Requirements (PRD)](./docs/PRD.md)
- [Interview Challenge](./docs/interview.md)

## License

MIT
