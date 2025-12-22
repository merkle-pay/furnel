# Furnel - Product Requirements Document

> **Furnel** = **F**iat **U**SDC/USDT **R**emittance Tun**NEL**

## Overview

An open-source Temporal workflow that orchestrates cross-border payments using stablecoin rails:

```
USDC (Solana) → Local Currency (fiat)
```

User acquires USDC on their own (via MoonPay, Coinbase, exchange, etc.). Furnel handles the offramp to local currency.

## Payment Flow

```
1. User has USDC in their Solana wallet
2. User initiates payment (amount, recipient bank details)
3. User sends USDC to Furnel's wallet
4. Furnel detects USDC received
5. Furnel locks FX rate with offramp partner
6. Furnel sends USDC to offramp partner (Coinbase/Transak)
7. Offramp partner sends local currency to recipient's bank
8. Confirm delivery, complete transaction
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Orchestration** | Temporal |
| **API** | Hono (Node.js) |
| **Database** | PostgreSQL |
| **Blockchain** | Solana (USDC-SPL) |
| **Offramp** | Coinbase Offramp / Transak |
| **Reverse Proxy** | Caddy |

## Provider Integration

### Offramp: Coinbase / Transak

| Provider | Fees | Coverage |
|----------|------|----------|
| **Coinbase Offramp** | 0% for USDC | US, EU, UK |
| **Transak** | 1% | Global, 40+ cryptos |

### Coinbase Offramp Integration

**Important:** Coinbase Offramp is a **redirect flow**, not a pure API.

```
Flow:
1. Generate sell quote → Get redirect URL
2. User clicks URL → Redirected to Coinbase UI
3. User completes KYC/auth on Coinbase
4. User confirms sell order
5. Coinbase sends local currency to user's bank
6. We receive webhook notification
```

**Environment Variables:**

```bash
CDP_PROJECT_ID=        # Coinbase Developer Platform project ID
CDP_API_KEY_ID=        # API key ID
CDP_API_KEY_NAME=      # API key name (e.g., "organizations/.../apiKeys/...")
CDP_API_KEY_PRIVATE_KEY=  # Private key (PEM format)
```

**Temporal Workflow Integration:**

```
PaymentWorkflow
├── waitForUSDC()       → Detect USDC deposit on Solana
├── generateOfframpURL()→ Get Coinbase redirect URL
├── [USER INTERACTION]  → User clicks URL, completes on Coinbase
├── waitForWebhook()    → Wait for Coinbase webhook
├── confirmDelivery()   → Verify funds sent
└── Compensation        → Refund USDC if user cancels
```

**Limitation:** Since user must interact with Coinbase UI, we cannot do fully automated offramp. The workflow pauses and waits for user action.

### Alternative Providers

| Provider | Best For |
|----------|----------|
| **Yellow Card** | Africa (20 countries) |
| **Mural Pay** | LATAM (ARS, BRL, MXN) |
| **Bitso** | Mexico, Argentina, Brazil |

## Technical Architecture

### Temporal Workflow

```
PaymentWorkflow
├── waitForUSDC()       → Detect USDC deposit
├── lockFXRate()        → Get rate from offramp partner
├── executeOfframp()    → Coinbase/Transak: USDC → local currency
├── confirmDelivery()   → Verify funds received
└── Compensation        → Rollback on failure (Saga pattern)
```

### State Transitions

```
INITIATED
  ↓
WAITING_FOR_USDC → USDC_TIMEOUT
  ↓
USDC_RECEIVED
  ↓
FX_LOCKED
  ↓
OFFRAMPING → OFFRAMP_FAILED
  ↓
LOCAL_SENT
  ↓
COMPLETED

(Any failure → COMPENSATING → REFUNDED)
```

### Compensation (Saga Pattern)

If offramp fails after USDC received:
1. Refund USDC to user's wallet

## Database Schema

### Core Tables

- `payments` — Main payment record
- `payment_state_transitions` — Audit log
- `transactions` — Individual transactions (deposit, offramp)
- `fx_rates` — Locked FX rates

### Key Indexes

- `payments(status, created_at)`
- `payments(user_id, created_at)`
- `payment_state_transitions(payment_id, created_at)`

## Testing Strategy

### Development (Sandbox)

- Coinbase/Transak sandbox APIs
- Solana Devnet for USDC
- No real money

### Staging (Real Money)

- Use **Wise** multi-currency account as recipient
- Wise provides local bank details for 50+ currencies
- Test corridor: `USDC → GBP (Wise UK account)`

## Scaling ($10M+ Daily Volume)

- Temporal worker horizontal scaling
- Database read replicas
- Rate limiting on external APIs
- Idempotency keys everywhere
- Batch processing optimization (future)

## Q&A

**Q: How does user get USDC?**

A: Not our problem. User gets USDC however they want (MoonPay, Coinbase, exchange, friend, etc.).

**Q: KYC/AML requirements?**

A: Not needed for us. Offramp partner (Coinbase/Transak) handles KYC. We're just orchestration middleware.

**Q: Which blockchain for USDC?**

A: Solana (USDC-SPL). Low fees, fast finality.

**Q: How to test without foreign bank accounts?**

A: Use Wise multi-currency account.

## Sources

- [Coinbase Offramp](https://www.coinbase.com/developer-platform/discover/launches/introducing-offramp)
- [Transak Off-Ramp](https://transak.com/off-ramp)
- [Temporal Documentation](https://docs.temporal.io/)
