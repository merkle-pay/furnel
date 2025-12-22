# Furnel

> **F**iat **U**SDC/USDT **R**emittance Tun**NEL**

Open-source cross-border payment orchestration using stablecoin rails.

**User sees:** USD → GBP/EUR
**Reality:** USD → [USDC] → GBP/EUR (crypto is invisible)

## How It Works

1. User enters amount (USD) and recipient bank details
2. User pays with card via MoonPay widget
3. MoonPay sends USDC directly to Furnel
4. Furnel offramps via Coinbase
5. Recipient receives local currency in their bank

**No crypto wallet needed.** Users pay with card, recipients get bank transfer.

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
- [Payment Flow (Step-by-Step)](./docs/furnel-flow.md)
- [MoonPay Integration](./docs/moonpay.md)
- [Interview Challenge](./docs/interview.md)

---

## Design Decisions

### Why Temporal?

We chose [Temporal](https://temporal.io/) over alternatives (Bull/BullMQ, custom state machines, AWS Step Functions) for several reasons:

| Requirement | Temporal Solution |
|-------------|-------------------|
| **Long-running workflows** | Native support for workflows lasting hours/days (waiting for USDC, offramp completion) |
| **Automatic retries** | Built-in exponential backoff, configurable per-activity |
| **State durability** | Workflow state survives crashes, restarts, deployments |
| **Visibility** | Temporal UI shows real-time workflow status, history, pending activities |
| **Compensation** | Saga pattern with tracked rollback steps |
| **Signals/Queries** | External events (webhooks) can signal workflows; state queryable anytime |

**Trade-off:** Temporal adds operational complexity (separate server, database). Worth it for payment reliability.

### Why USDC on Solana?

| Factor | Solana | Ethereum | Reason |
|--------|--------|----------|--------|
| **Fees** | ~$0.001 | $5-50 | Critical for small remittances |
| **Finality** | ~400ms | ~12min | Better UX |
| **USDC liquidity** | High | Highest | Both sufficient |

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
├── confirmDelivery (activity) ─ Wait for completion
└── compensate() ────────────── Saga rollback on failure
```

### Signals

Signals allow external events to affect running workflows:

```typescript
// Defined signals
usdcReceivedSignal    // MoonPay webhook → workflow
offrampCompletedSignal // Coinbase webhook → workflow
cancelPaymentSignal    // User cancellation request
```

**Usage:** When MoonPay webhook arrives, API can signal the workflow instead of relying solely on polling:

```typescript
// In webhook handler
await temporalClient.workflow.signalWithStart('paymentWorkflow', {
  workflowId: paymentId,
  signal: usdcReceivedSignal,
  signalArgs: [{ txHash, amount }],
});
```

### Queries

Queries allow reading workflow state without affecting execution:

```typescript
// Defined queries
getPaymentStateQuery        // Current payment state
getCompensationHistoryQuery // Saga steps for debugging
```

**Usage:** API can query workflow state directly instead of relying on database:

```typescript
const state = await handle.query(getPaymentStateQuery);
```

### Child Workflows

Child workflows isolate concerns and enable independent retry policies:

```typescript
// onrampWorkflow - isolated USDC detection
// - Has its own timeout (30 min)
// - Can be restarted independently
// - Parent workflow continues if child succeeds

const result = await executeChild(onrampWorkflow, {
  workflowId: `${paymentId}-onramp`,
  parentClosePolicy: ParentClosePolicy.TERMINATE,
});
```

### Saga Pattern (Compensation)

We track each step that may need rollback:

```typescript
interface CompensationStep {
  action: "USDC_RECEIVED" | "FX_LOCKED" | "OFFRAMP_INITIATED";
  timestamp: Date;
  data: Record<string, unknown>;
  compensated: boolean;
}
```

On failure, compensate in **reverse order**:

```
Forward:  USDC_RECEIVED → FX_LOCKED → OFFRAMP_INITIATED
Rollback: OFFRAMP_INITIATED → FX_LOCKED → USDC_RECEIVED
```

| Step | Compensation Action |
|------|---------------------|
| `USDC_RECEIVED` | Refund USDC to user wallet |
| `FX_LOCKED` | No action (rate expires naturally) |
| `OFFRAMP_INITIATED` | Cancel with Coinbase or wait for expiry |

---

## Database Schema Design

### Tables Overview

```
payments                    # Main payment record
payment_state_transitions   # Audit log (append-only)
refunds                     # Compensation tracking
webhook_events              # External event log
```

### Design Principles

#### 1. Idempotency via Primary Keys

```sql
-- Payment ID is application-generated (UUID or similar)
-- Allows idempotent creation: same ID = same payment
id VARCHAR(64) PRIMARY KEY
```

#### 2. Audit Trail via State Transitions

```sql
-- Every status change is recorded
-- Enables debugging, compliance, analytics
CREATE TABLE payment_state_transitions (
    payment_id VARCHAR(64) REFERENCES payments(id),
    status VARCHAR(50) NOT NULL,
    metadata JSONB,        -- Additional context
    created_at TIMESTAMPTZ -- When transition occurred
);
```

**Why append-only?** Never delete history. Compliance requires full audit trail.

#### 3. Denormalized for Read Performance

```sql
-- Status stored in payments table (fast reads)
-- Also in transitions table (audit trail)
-- Acceptable redundancy for payment systems
status VARCHAR(50) NOT NULL DEFAULT 'INITIATED'
```

#### 4. JSONB for Flexible Metadata

```sql
-- Webhook payloads vary by provider
-- JSONB allows schema flexibility
payload JSONB NOT NULL
```

### Indexes Strategy

```sql
-- Query patterns → Index design
idx_payments_status           -- Dashboard: show pending payments
idx_payments_deposit_address  -- Webhook: find payment by address
idx_payments_created_at       -- Reports: time-range queries
idx_payments_quote_id         -- Coinbase callback lookup
idx_payments_offramp_order_id -- Delivery confirmation lookup
```

### Why No Separate Transactions Table?

PRD mentioned a `transactions` table. We chose to embed transaction data in `payments`:

| Approach | Pros | Cons |
|----------|------|------|
| Separate `transactions` table | Normalized, flexible | JOIN overhead, complexity |
| Embedded in `payments` | Simple queries, fast | Less flexible for multi-tx |

**Decision:** Single USDC deposit + single offramp per payment. Embedding is simpler.

---

## Scaling to $10M+ Daily Volume

### Volume Estimates

```
$10M daily ÷ $200 avg payment = 50,000 payments/day
50,000 ÷ 86,400 seconds = ~0.6 payments/second average
Peak (10x average) = ~6 payments/second
```

### Horizontal Scaling Strategy

#### 1. Temporal Workers

```yaml
# Scale workers independently
workers:
  replicas: 3-10  # Based on activity throughput
  resources:
    cpu: 1-2 cores
    memory: 512MB-1GB
```

**Key insight:** Temporal workers are stateless. Add more for throughput.

#### 2. Database Scaling

```
Phase 1: Vertical scaling (bigger instance)
         - Good up to ~100k payments/day

Phase 2: Read replicas
         - API reads from replica
         - Writes to primary
         - Webhook handlers write to primary

Phase 3: Partitioning (if needed)
         - Partition payments by created_at (monthly)
         - Archive old partitions to cold storage
```

#### 3. Connection Pooling

```typescript
// Use PgBouncer or built-in pooling
const pool = new Pool({
  max: 20,              // Max connections per worker
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Idempotency Keys

**Critical for payment systems.** Every external API call must be idempotent:

```typescript
// Coinbase quote request
{
  partner_user_id: paymentId,  // Idempotency key
  // ... other params
}

// MoonPay widget
{
  externalTransactionId: paymentId,  // Idempotency key
}
```

### Rate Limiting

```typescript
// External API limits (approximate)
// MoonPay: 100 req/min
// Coinbase: 10,000 req/min
// Solana RPC: varies by provider

// Strategy: Queue requests, respect limits
const rateLimiter = new RateLimiter({
  moonpay: { maxPerMinute: 80 },   // 80% of limit
  coinbase: { maxPerMinute: 8000 },
  solana: { maxPerSecond: 10 },
});
```

### Monitoring & Alerting

```yaml
Metrics to track:
  - payments_created_total (counter)
  - payments_completed_total (counter)
  - payment_duration_seconds (histogram)
  - workflow_failures_total (counter)
  - external_api_latency_seconds (histogram)

Alerts:
  - Payment success rate < 95%
  - Average completion time > 30 minutes
  - Workflow failure rate > 1%
  - External API error rate > 5%
```

### Disaster Recovery

```
1. Database backups: Every 6 hours, retained 30 days
2. Point-in-time recovery: Enabled (PostgreSQL WAL)
3. Temporal: Workflow history persisted, survives crashes
4. Multi-region: Future consideration for 99.99% uptime
```

### Cost Optimization

| Component | Cost Driver | Optimization |
|-----------|-------------|--------------|
| Solana RPC | Request volume | Use dedicated node at scale |
| Database | Storage, IOPS | Archive old data, optimize queries |
| Temporal | Workflow history | Set retention policy (30 days) |
| Coinbase | Per-transaction | Batch where possible |

---

## Future Improvements

1. **Real FX rate integration** — Replace mock rates with live Coinbase quotes
2. **Automated USDC refunds** — Implement actual Solana transfers in `refundUSDC()`
3. **Webhook signature verification** — Complete Coinbase webhook validation
4. **Multi-currency support** — Add more offramp corridors (Africa, LATAM)
5. **Batch processing** — Aggregate small payments for efficiency
6. **Real-time notifications** — WebSocket updates to frontend

---

## License

MIT
