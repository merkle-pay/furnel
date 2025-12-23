# Furnel - Product Requirements Document

> **Furnel** = **F**iat **U**SDC/USDT **R**emittance Tun**NEL**

## Overview

An open-source Temporal workflow that orchestrates cross-border payments using stablecoin rails.

**User sees:** USD → GBP/EUR
**Reality:** USD → [USDC] → GBP/EUR (USDC is invisible)

## Payment Flow

```
1. User enters amount (USD) and recipient bank details
2. User pays with card via MoonPay widget
3. MoonPay converts USD → USDC and sends to Furnel's deposit address
4. Furnel detects USDC received
5. Furnel locks FX rate with Coinbase
6. User completes offramp on Coinbase (redirect flow)
7. Coinbase sends local currency to recipient's bank
8. Done - recipient receives GBP/EUR
```

**Key principle:** Users never handle USDC directly. It's just the rail.

## Tech Stack

| Component         | Technology                          |
| ----------------- | ----------------------------------- |
| **Orchestration** | Temporal                            |
| **API**           | Hono (Node.js)                      |
| **Database**      | PostgreSQL                          |
| **Blockchain**    | Solana (USDC-SPL)                   |
| **Onramp**        | MoonPay (browser widget)            |
| **Offramp**       | Coinbase Offramp (browser redirect) |
| **Reverse Proxy** | Caddy                               |

## Frontend Integration

Both onramp (MoonPay) and offramp (Coinbase) happen in the **browser**, not on the server.

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Payment Form        2. MoonPay Widget     3. Coinbase       │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │ Amount: $100 │  →   │  Pay with    │  →   │  Complete    │  │
│  │ Recipient:   │      │  Card        │      │  Offramp     │  │
│  │ John Doe     │      │              │      │              │  │
│  │ Sort: 12-34  │      │  (popup)     │      │  (redirect)  │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│                                                                  │
│  User never sees or handles USDC - it's invisible               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SERVER (Furnel)                          │
├─────────────────────────────────────────────────────────────────┤
│  - Generate unique deposit address                              │
│  - MoonPay sends USDC directly to deposit address               │
│  - Detect USDC on Solana                                        │
│  - Generate Coinbase offramp URL                                │
│  - Wait for webhook confirmation                                │
└─────────────────────────────────────────────────────────────────┘
```

### MoonPay Onramp (Browser Widget)

MoonPay widget sends USDC directly to Furnel's deposit address. User pays with card, never touches crypto.

```tsx
<MoonPayBuyWidget
  baseCurrencyCode="usd"
  baseCurrencyAmount="100"
  defaultCurrencyCode="usdc_sol"
  walletAddress={depositAddress} // Furnel's address, not user's
/>
```

### Coinbase Offramp (Browser Redirect)

Server generates URL, user clicks and completes on Coinbase.

```
1. Server calls Coinbase API → gets offramp URL
2. Frontend shows "Complete on Coinbase" button
3. User clicks → redirected to Coinbase
4. User completes sale on Coinbase UI
5. Coinbase sends local currency to recipient's bank
```

**Why this architecture?**

- User never needs a crypto wallet
- MoonPay/Coinbase handle KYC and compliance
- USDC is just the invisible rail between fiat endpoints

## Provider Integration

### Offramp: Coinbase / Transak

| Provider             | Fees        | Coverage            |
| -------------------- | ----------- | ------------------- |
| **Coinbase Offramp** | 0% for USDC | US, EU, UK          |
| **Transak**          | 1%          | Global, 40+ cryptos |

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

| Provider        | Best For                  |
| --------------- | ------------------------- |
| **Yellow Card** | Africa (20 countries)     |
| **Mural Pay**   | LATAM (ARS, BRL, MXN)     |
| **Bitso**       | Mexico, Argentina, Brazil |

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
- more payment methods for both senders and recipients

## Q&A

**Q: Does the user need a crypto wallet?**

A: No. User pays with card via MoonPay. USDC goes directly to Furnel's deposit address. User never handles crypto.

**Q: Does the recipient know about USDC?**

A: No. Recipient just receives local currency (GBP, EUR, etc.) in their bank account.

**Q: KYC/AML requirements?**

A: Not needed for us. MoonPay handles onramp KYC, Coinbase handles offramp KYC. We're just orchestration middleware.

**Q: Which blockchain for USDC?**

A: Solana (USDC-SPL). Low fees, fast finality.

**Q: How to test without foreign bank accounts?**

A: Use Wise multi-currency account.

## Sources

- [Coinbase Offramp](https://www.coinbase.com/developer-platform/discover/launches/introducing-offramp)
- [Transak Off-Ramp](https://transak.com/off-ramp)
- [Temporal Documentation](https://docs.temporal.io/)
