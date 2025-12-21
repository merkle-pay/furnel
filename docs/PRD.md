# Stablecoin Payment Flow - Product Requirements Document

## Overview

Build an open-source Temporal workflow that orchestrates cross-border payments using stablecoin rails:

```
USD (fiat) → USDC (stablecoin) → Local Currency (fiat)
```

## Payment Flow

```
1. User initiates payment (USD amount, recipient details)
2. Collect USD from user's bank (ACH/wire)
3. Mint/acquire USDC via Circle
4. Lock FX rate with offramp partner
5. Send USDC to offramp partner
6. Offramp partner delivers local currency to recipient
7. Confirm delivery, complete transaction
```

## Offramp Provider Research (December 2025)

### Primary Recommendation: Circle + Coinbase

| Provider | Best For | Fees | Coverage | API Quality |
|----------|----------|------|----------|-------------|
| **Circle** | USDC minting, enterprise | Varies | Global | Excellent |
| **Coinbase Offramp** | US users, developer-friendly | 0% for USDC | US, EU, UK | Excellent |

### Alternative Providers

| Provider | Best For | Fees | Coverage |
|----------|----------|------|----------|
| **Transak** | Global coverage | 1% | 40+ cryptos, 4 chains |
| **MoonPay** | Non-custodial, global | Varies | Global |
| **Yellow Card** | Africa corridor | Varies | 20 African countries |
| **Mural Pay** | LATAM | Varies | ARS, BRL, MXN |
| **Bitso** | Mexico, Argentina, Brazil | Varies | LATAM |
| **Ramp Network** | EU, Pix/SPEI rails | Varies | EU, LATAM |

### Aggregator Option

| Provider | Notes |
|----------|-------|
| **Onramper** | Aggregates 30+ providers, single integration |

### Not Recommended

| Provider | Reason |
|----------|--------|
| **OKX P2P** | Requires Super/Diamond Merchant status, not developer accessible |

## Circle API Overview

### Circle Mint (for USDC minting)
- Mint new USDC from USD
- Redeem USDC 1:1 for USD
- **Note:** Available to exchanges, institutions, banks — not individuals/small businesses

### Circle Payments Network (CPN)
- **OFI (Originating Financial Institution):** Onramp fiat → USDC
- **BFI (Beneficiary Financial Institution):** Offramp USDC → local fiat
- Designed for cross-border transactions

### Developer Environment
- **Sandbox:** Test environment, no real money
- **Production:** Live transactions

## Technical Architecture

### Temporal Workflows

```
PaymentWorkflow (parent)
├── CollectUSDActivity
├── MintUSDCActivity (or AcquireUSDCActivity)
├── LockFXRateActivity
├── OfframpActivity
│   └── OfframpChildWorkflow (for complex multi-step offramps)
├── ConfirmDeliveryActivity
└── CompensationActivities (rollback on failure)
```

### Compensation (Saga Pattern)

If any step fails, execute compensating transactions in reverse order:
- `OfframpActivity` fails → `RefundUSDCActivity` → `ReturnUSDActivity`

### State Transitions

```
INITIATED
  ↓
USD_COLLECTING → USD_COLLECTION_FAILED
  ↓
USD_COLLECTED
  ↓
USDC_MINTING → USDC_MINT_FAILED
  ↓
USDC_MINTED
  ↓
FX_LOCKING → FX_LOCK_FAILED
  ↓
FX_LOCKED
  ↓
OFFRAMPING → OFFRAMP_FAILED
  ↓
LOCAL_SENT
  ↓
CONFIRMING → CONFIRMATION_FAILED
  ↓
COMPLETED

(Any failure state can transition to COMPENSATING → REFUNDED)
```

## Database Schema (High-Level)

### Core Tables
- `payments` - Main payment record
- `payment_state_transitions` - Audit log of state changes
- `transactions` - Individual transactions (USD collect, USDC mint, offramp)
- `fx_rates` - Locked FX rates
- `fees` - Fee breakdown per payment

### Key Indexes
- `payments(status, created_at)` - For querying pending payments
- `payments(user_id, created_at)` - For user payment history
- `payment_state_transitions(payment_id, created_at)` - For audit trail

## Recipient Delivery Methods

The offramp partner handles "last mile" delivery. Supported methods depend on the partner and region:

| Method | Examples | Common In |
|--------|----------|-----------|
| **Bank transfer** | SWIFT, local rails (Faster Payments, SEPA) | Global |
| **Mobile money** | M-Pesa, MTN MoMo, GCash | Africa, SEA |
| **E-wallets** | Paytm, GrabPay, Alipay | Asia |
| **Cash pickup** | Western Union style networks | Unbanked populations |

## Testing Strategy

### Development (Sandbox)
- Use provider sandbox/testnet environments
- No real money, no real bank accounts needed
- Simulates full flow including success/failure scenarios

### Staging (Real Money, Small Amounts)
- Use **Wise** multi-currency account as recipient
- Wise provides local bank details for 50+ currencies:
  - GBP: UK sort code + account number
  - EUR: IBAN
  - AUD, NZD, SGD, etc.
- Test full end-to-end flow with real funds landing in your own Wise account

### Initial Test Corridor
```
USD (US bank) → USDC → GBP (Wise UK account)
```
- GBP chosen because Wise provides real UK bank details
- Liquid corridor with good offramp support
- Easy to verify receipt and convert back to USD

### Production
- Expand to additional corridors based on demand
- Partner with local offramp providers for better rates/coverage

## Scaling Considerations ($10M+ Daily Volume)

- Temporal worker scaling (horizontal)
- Database read replicas
- Rate limiting on external API calls
- Idempotency keys for all external operations
- Reconciliation jobs for detecting discrepancies

## Q&A

**Q: Which offramp partner(s) to integrate first?**

A: Start with Coinbase Offramp or Transak for GBP corridor.

**Q: KYC/AML requirements for the flow?**

A: Not needed. Onramp (Coinbase) and offramp (Wise/partner) handle KYC. This system is orchestration middleware only — just moving USDC between regulated entities.

**Q: Which blockchains to support for USDC?**

A: Solana (USDC-SPL). Personal preference, nothing special. Coinbase supports it, low fees, fast finality.

**Q: How to test without foreign bank accounts?**

A: Use Wise multi-currency account.

**Q: Real-time vs batch processing for high volume?**

A: Real-time for now. Batch processing is a future optimization for $10M+ daily volume — aggregate multiple payments into single USDC transfers to reduce blockchain fees and get better FX rates. Tradeoff is latency.

## Sources

- [Circle Developer Docs](https://developers.circle.com)
- [Circle Payments Network](https://developers.circle.com/cpn)
- [Coinbase Offramp](https://www.coinbase.com/developer-platform/discover/launches/introducing-offramp)
- [Transak Off-Ramp](https://transak.com/off-ramp)
- [Yellow Card API](https://yellowcard.io/blog/leveraging-apis-for-crypto-to-fiat-conversions-in-cross-border-payments/)
- [Mural Pay](https://www.muralpay.com/blog/best-stablecoin-off-ramp-providers)
- [Onramper](https://www.onramper.com)
- [Token Metrics - Top On/Off Ramp Providers 2025](https://www.tokenmetrics.com/blog/top-on-off-ramp-providers-fiat---crypto-2025)
