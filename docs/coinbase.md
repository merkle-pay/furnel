# Coinbase CDP Offramp Integration

## Overview

This document captures the problems encountered and solutions implemented when integrating with the Coinbase CDP (Coinbase Developer Platform) Offramp API.

## Problems & Solutions

### 1. JWT Authentication - 401 Unauthorized

**Problem:** Initial JWT generation resulted in `401 Unauthorized` errors.

**Root Cause:** Manual JWT generation had incorrect claims and format.

**Solution:** Use the official `@coinbase/cdp-sdk` package which handles both Ed25519 and ECDSA key formats automatically.

```typescript
import { generateJwt } from "@coinbase/cdp-sdk/auth";

const token = await generateJwt({
  apiKeyId: `organizations/${projectId}/apiKeys/${keyId}`,
  apiKeySecret: privateKey,
  requestMethod: "POST",
  requestHost: "api.developer.coinbase.com",
  requestPath: "/onramp/v1/sell/quote",
  expiresIn: 120,
});
```

**Key Points:**
- `apiKeyId` must be in full path format: `organizations/{projectId}/apiKeys/{keyId}`
- The SDK auto-detects key type (Ed25519 base64 vs ECDSA PEM)
- New CDP keys (Feb 2025+) default to Ed25519

### 2. Empty offramp_url in Response

**Problem:** API returned a quote but `offramp_url` was empty string `""`.

**Root Cause:** Missing `sourceAddress` parameter.

**Solution:** Include `sourceAddress` in the request - this is required to generate the One-Click-Sell URL.

```typescript
body: JSON.stringify({
  sellCurrency: "USDC",
  sellAmount: "5",
  sellNetwork: "solana",
  cashoutCurrency: "USD",
  paymentMethod: "FIAT_WALLET",
  country: "US",
  subdivision: "CA",
  sourceAddress: "FK4EwSrrTMR3SgakUxakbFzdPWT8nQLLLTZqEbJEM8Uw", // Required!
  redirectUrl: "https://your-domain.com/api/webhooks/coinbase/callback",
  partnerUserId: "payment_id_123",
}),
```

### 3. Invalid Address for Blockchain

**Problem:** `"address [FK4Ew...] is not valid for blockchain [ethereum]"`

**Root Cause:** Solana address provided but `sellNetwork` not specified (defaults to Ethereum).

**Solution:** Always specify `sellNetwork` to match the address format:
- Solana address → `sellNetwork: "solana"`
- Ethereum/Base address → `sellNetwork: "ethereum"` or `sellNetwork: "base"`

### 4. Amount Below Payment Method Limits

**Problem:** `"purchase amount 5 is not within the payment method limits for ACH_BANK_ACCOUNT"`

**Root Cause:** ACH bank transfers have a minimum of ~$10.

**Solution:** Use `FIAT_WALLET` payment method which has a $1 minimum:

```typescript
paymentMethod: "FIAT_WALLET", // Minimum $1
// vs
paymentMethod: "ACH_BANK_ACCOUNT", // Minimum ~$10
```

**Payment Method Limits:**
| Method | Min | Max |
|--------|-----|-----|
| FIAT_WALLET | $1 | $50,000 |
| ACH_BANK_ACCOUNT | $10 | $25,000 |
| RTP | $10 | $5,000 |
| PAYPAL | $10 | $5,000 |

### 5. Localhost Redirect Issues

**Problem:** Coinbase redirects back without query parameters when using `localhost`.

**Symptoms:**
- Callback receives empty params: `{}`
- User sees `/payment/success?id=unknown`
- JavaScript errors on Coinbase Pay page ("SDK platform not initialized")

**Root Cause:** Coinbase Pay doesn't fully support localhost redirects.

**Solution:** Use a tunnel service (ngrok, Cloudflare Tunnel) for development:

```bash
# Cloudflare Tunnel
cloudflared tunnel --url http://localhost:80

# ngrok
ngrok http 80
```

Then set `CALLBACK_DOMAIN` environment variable:
```env
CALLBACK_DOMAIN=https://your-tunnel-url.trycloudflare.com
```

### 6. Funds Not Available for Transfer

**Problem:** User has USDC in Coinbase but offramp fails silently.

**Root Cause:** Newly deposited funds have a hold period:
- "Available to trade" = can buy/sell within Coinbase
- "Available to transfer" = can withdraw/send (3-5 business days for ACH)

**Solution:** Wait for funds to clear the hold period, or use already-cleared funds.

### 7. Quote Expiration

**Problem:** "We're looking into it right now" error on Coinbase Pay.

**Root Cause:** Coinbase quotes expire after ~2 minutes.

**Solution:** User must click the offramp link immediately after generation.

## Environment Variables

```env
# CDP API credentials
CDP_PROJECT_ID=your-project-id
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_PRIVATE_KEY=base64-encoded-ed25519-key

# Solana wallet for offramp
FURNEL_DEPOSIT_ADDRESS=your-solana-address

# Callback domain (use tunnel for local dev)
CALLBACK_DOMAIN=https://your-domain.com
```

## API Request Example

```typescript
const response = await fetch("https://api.developer.coinbase.com/onramp/v1/sell/quote", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${jwtToken}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
  body: JSON.stringify({
    sellCurrency: "USDC",
    sellAmount: "10",
    sellNetwork: "solana",
    cashoutCurrency: "USD",
    paymentMethod: "FIAT_WALLET",
    country: "US",
    subdivision: "CA",
    sourceAddress: "FK4EwSrrTMR3SgakUxakbFzdPWT8nQLLLTZqEbJEM8Uw",
    redirectUrl: "https://your-domain.com/api/webhooks/coinbase/callback",
    partnerUserId: "unique-payment-id",
  }),
});
```

## API Response Example

```json
{
  "cashout_total": { "value": "9.90", "currency": "USD" },
  "cashout_subtotal": { "value": "10", "currency": "USD" },
  "sell_amount": { "value": "10", "currency": "USDC" },
  "coinbase_fee": { "value": "0.10", "currency": "USD" },
  "quote_id": "uuid-here",
  "offramp_url": "https://pay.coinbase.com/v3/sell/input?..."
}
```

## Resources

- [CDP Offramp API Docs](https://docs.cdp.coinbase.com/onramp/docs/api-offramp)
- [CDP API Keys](https://docs.cdp.coinbase.com/get-started/docs/cdp-api-keys)
- [Coinbase Onramp Demo App](https://github.com/coinbase/onramp-demo-app)
