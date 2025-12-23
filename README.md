# Furnel

> **F**iat **U**SDC/USDT **R**emittance Tun**NEL**

Open-source cross-border payment orchestration using stablecoin rails.

**User sees:** USD → GBP/EUR

**Reality:** USD → [USDC] → GBP/EUR (crypto is invisible)

## How It Works

1. Sender enters amount (USD) and recipient details (name, email, bank info)
2. Sender pays with card via MoonPay widget → USDC sent to Furnel deposit address
3. Workflow detects USDC, locks FX rate, generates Coinbase offramp link
4. **Recipient receives email** with Coinbase link
5. Recipient clicks link, completes KYC on Coinbase, receives local currency in their bank

**No crypto wallet needed.** Sender pays with card, recipient gets a link and receives bank transfer.

All orchestrated by [Temporal](https://temporal.io/) with automatic retry, compensation (rollback), and full audit trail.

## Tech Stack

- **Temporal** — Workflow orchestration
- **Hono** — API framework
- **PostgreSQL** — Database
- **React + Vite** — Frontend
- **MoonPay** — Onramp (card → USDC)
- **Coinbase CDP** — Offramp (USDC → local currency)
- **Solana** — Blockchain (USDC-SPL)
- **Caddy** — Reverse proxy

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Cloudflare Tunnel (for webhook testing)
- MoonPay API keys (sandbox)
- Coinbase CDP API keys

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

# Start cloudflared tunnel (fixed URL)
make tunnel

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

# Coinbase CDP
CDP_PROJECT_ID=your_project_id
CDP_API_KEY_ID=your_key_id
CDP_API_KEY_PRIVATE_KEY=your_private_key_base64

# MoonPay
VITE_MOONPAY_API_KEY=pk_test_...
MOONPAY_SECRET_KEY=sk_test_...
MOONPAY_WEBHOOK_SIGNING_KEY=wk_test_...

# Solana
SOLANA_RPC=https://api.mainnet-beta.solana.com
FURNEL_DEPOSIT_ADDRESS=your_solana_address

# Callback domain (for Coinbase redirect)
CALLBACK_DOMAIN=https://your-tunnel.heex.dev
```

## API Endpoints

| Method | Path                             | Description                    |
| ------ | -------------------------------- | ------------------------------ |
| `POST` | `/api/payments`                  | Create new payment             |
| `GET`  | `/api/payments/:id`              | Get payment status             |
| `GET`  | `/api/payments`                  | List recent payments           |
| `POST` | `/api/webhooks/moonpay`          | MoonPay webhook                |
| `POST` | `/api/webhooks/coinbase`         | Coinbase webhook               |
| `GET`  | `/api/webhooks/coinbase/callback`| Coinbase redirect callback     |
| `GET`  | `/api/health`                    | Health check                   |

### Create Payment

```bash
curl -X POST http://localhost/api/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "GBP",
    "recipientName": "John Doe",
    "recipientEmail": "john@example.com",
    "recipientAccountNumber": "12345678",
    "recipientSortCode": "123456"
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
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
             ┌─────────────┐           ┌─────────────┐            ┌─────────────┐
             │  MoonPay    │           │  Coinbase   │            │   Email     │
             │  (onramp)   │           │  (offramp)  │            │  (notify)   │
             └─────────────┘           └─────────────┘            └─────────────┘
```

## Payment Flow

```
SENDER                          FURNEL                         RECIPIENT
  │                               │                               │
  │  1. Enter amount + recipient  │                               │
  │  ──────────────────────────▶  │                               │
  │                               │                               │
  │  2. MoonPay widget opens      │                               │
  │  ◀──────────────────────────  │                               │
  │                               │                               │
  │  3. Buy USDC with card        │                               │
  │  ──────────────────────────▶  │                               │
  │                               │                               │
  │                               │  4. Detect USDC               │
  │                               │  5. Lock FX rate              │
  │                               │  6. Generate Coinbase URL     │
  │                               │                               │
  │                               │  7. Send email with link      │
  │                               │  ─────────────────────────▶   │
  │                               │                               │
  │                               │  8. Click link, complete KYC  │
  │                               │  ◀─────────────────────────   │
  │                               │                               │
  │                               │  9. Coinbase sends to bank    │
  │                               │  ─────────────────────────▶   │
  │                               │                               │
  │  10. Payment complete         │                               │
  │  ◀──────────────────────────  │                               │
```

## Workflow States

```
INITIATED
    ↓
WAITING_FOR_USDC ──────────────▶ USDC_FAILED
    ↓
USDC_RECEIVED
    ↓
LOCKING_FX
    ↓
GENERATING_OFFRAMP_URL
    ↓
SENDING_RECIPIENT_EMAIL
    ↓
AWAITING_RECIPIENT_ACTION
    ↓
WAITING_FOR_OFFRAMP ───────────▶ OFFRAMP_FAILED ──▶ COMPENSATING ──▶ REFUNDED
    ↓
DELIVERED
    ↓
COMPLETED
```

## Development

```bash
make up       # Start production services
make down     # Stop services
make dev-up   # Start development services
make dev-down # Stop development services
make dev-logs # View development logs
make health   # Check status
make clean    # Remove all data (volumes)
make hash     # Generate password hash
make tunnel   # Start cloudflared tunnel (fixed URL)
```

## Testing

### Sandbox Mode

- **MoonPay:** Sends ETH to Sepolia (USDC not in sandbox)
- **Coinbase:** Uses CDP sandbox with $5 minimum
- **Solana:** Uses Devnet RPC
- **FX Rates:** Mock rates (GBP: 0.79, EUR: 0.92)

### Webhook Testing

Set up a Cloudflare tunnel for a fixed URL:

```bash
# One-time setup
cloudflared tunnel login
cloudflared tunnel create furnel-dev
cloudflared tunnel route dns furnel-dev furnel-dev.yourdomain.com

# Run tunnel
make tunnel
```

Update `.env`:
```
CALLBACK_DOMAIN=https://furnel-dev.yourdomain.com
```

### Production Testing

1. Create a [Wise](https://wise.com) account
2. Get local bank details (GBP, EUR, etc.)
3. Test with small amounts
4. Verify funds land in Wise

## Documentation

- [Product Requirements (PRD)](./docs/PRD.md)
- [Payment Flow (Step-by-Step)](./docs/furnel-flow.md)
- [MoonPay Integration](./docs/moonpay.md)
- [Interview Challenge](./docs/interview.md)

---

## Design Decisions

### Why Temporal?

We chose [Temporal](https://temporal.io/) over alternatives (Bull/BullMQ, custom state machines, AWS Step Functions) for several reasons:

| Requirement                | Temporal Solution                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------- |
| **Long-running workflows** | Native support for workflows lasting hours/days (waiting for USDC, offramp completion) |
| **Automatic retries**      | Built-in exponential backoff, configurable per-activity                                |
| **State durability**       | Workflow state survives crashes, restarts, deployments                                 |
| **Visibility**             | Temporal UI shows real-time workflow status, history, pending activities               |
| **Compensation**           | Saga pattern with tracked rollback steps                                               |
| **Signals/Queries**        | External events (webhooks) can signal workflows; state queryable anytime               |

**Trade-off:** Temporal adds operational complexity (separate server, database). Worth it for payment reliability.

### Why Recipient Completes Offramp?

Traditional payment flows have passive recipients. We chose a **recipient-centric model**:

| Approach                 | Pros                              | Cons                           |
| ------------------------ | --------------------------------- | ------------------------------ |
| **Sender completes all** | Simple UX for sender              | Sender needs recipient's KYC   |
| **Recipient completes**  | No KYC sharing, compliance clean  | Recipient must take action     |

**Decision:** Recipient clicks Coinbase link and completes their own KYC. This:
1. Avoids sharing sensitive bank info with sender
2. Coinbase handles recipient compliance
3. Reduces Furnel's regulatory burden

### Why USDC on Solana?

| Factor             | Solana  | Ethereum | Reason                         |
| ------------------ | ------- | -------- | ------------------------------ |
| **Fees**           | ~$0.001 | $5-50    | Critical for small remittances |
| **Finality**       | ~400ms  | ~12min   | Better UX                      |
| **USDC liquidity** | High    | Highest  | Both sufficient                |

**Trade-off:** Solana has occasional network congestion. Mitigated by retry logic.

### Why Browser-Based Onramp/Offramp?

```
Option A: Server-side API integration (we control funds)
Option B: Browser redirects (MoonPay/Coinbase handle funds) ✓
```

We chose **Option B** because:

1. **No money transmission license needed** — We never custody funds
2. **KYC handled by partners** — MoonPay/Coinbase do compliance
3. **Reduced liability** — Funds flow directly between user and partners
4. **Faster to market** — No regulatory approval needed

**Trade-off:** Less control over UX, must wait for user interaction.

---

## Temporal Workflow Patterns

### Workflow Structure

```
paymentWorkflow (orchestrator)
├── onrampWorkflow (child) ──── Wait for USDC deposit
├── lockFXRate (activity) ───── Lock exchange rate
├── generateOfframpURL ──────── Get Coinbase redirect URL
├── sendRecipientEmail ──────── Email link to recipient
├── confirmDelivery (activity) ─ Wait for completion
└── compensate() ────────────── Saga rollback on failure
```

### Signals

Signals allow external events to affect running workflows:

```typescript
// Defined signals
usdcReceivedSignal; // MoonPay webhook → workflow
offrampCompletedSignal; // Coinbase webhook → workflow
cancelPaymentSignal; // User cancellation request
```

### Queries

Queries allow reading workflow state without affecting execution:

```typescript
// Defined queries
getPaymentStateQuery; // Current payment state
getCompensationHistoryQuery; // Saga steps for debugging
```

### Saga Pattern (Compensation)

We track each step that may need rollback:

```
Forward:  USDC_RECEIVED → FX_LOCKED → OFFRAMP_INITIATED
Rollback: OFFRAMP_INITIATED → FX_LOCKED → USDC_RECEIVED
```

| Step                | Compensation Action                     |
| ------------------- | --------------------------------------- |
| `USDC_RECEIVED`     | Refund USDC to user wallet              |
| `FX_LOCKED`         | No action (rate expires naturally)      |
| `OFFRAMP_INITIATED` | Cancel with Coinbase or wait for expiry |

---

## Database Schema

### Tables Overview

```
payments                    # Main payment record
payment_state_transitions   # Audit log (append-only)
refunds                     # Compensation tracking
webhook_events              # External event log
```

### Key Fields

```sql
-- payments table
id                  -- Application-generated UUID
deposit_address     -- Solana address for USDC
amount, currency    -- Payment details
recipient_name      -- Recipient's name
recipient_email     -- Email for offramp link
status              -- Current workflow state
usdc_tx_hash        -- MoonPay transaction hash
fx_rate             -- Locked exchange rate
quote_id            -- Coinbase quote ID
offramp_url         -- Generated Coinbase link
offramp_order_id    -- Coinbase order ID
```

---

## Scaling Considerations

### Horizontal Scaling

- **Temporal Workers:** Stateless, add more for throughput
- **Database:** Read replicas for API, primary for webhooks
- **Connection Pooling:** PgBouncer for high concurrency

### Idempotency

Every external API call uses idempotency keys:

```typescript
// Coinbase
{ partner_user_id: paymentId }

// MoonPay
{ externalTransactionId: paymentId }
```

---

## Future Improvements

1. **Real email delivery** — Replace mock with SendGrid/Resend
2. **Automated USDC refunds** — Implement actual Solana transfers
3. **Multi-currency support** — Add more offramp corridors (Africa, LATAM)
4. **Real-time updates** — WebSocket notifications to frontend
5. **Batch processing** — Aggregate small payments for efficiency

---

## License

MIT
