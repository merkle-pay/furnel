# MoonPay Integration

MoonPay handles the fiat-to-crypto onramp. Users pay with card, MoonPay sends USDC to Furnel's deposit address.

## Keys

| Key | Purpose | Location |
|-----|---------|----------|
| `pk_test_...` (publishable) | Frontend widget | `VITE_MOONPAY_API_KEY` |
| `sk_test_...` (secret) | Server-side URL signing | `MOONPAY_SECRET_KEY` |
| `wk_test_...` (webhook) | Verify webhook signatures | `MOONPAY_WEBHOOK_KEY` |

## Sandbox Testing

### Test Address

MoonPay sandbox requires specific test addresses:

```
0xc216eD2D6c295579718dbd4a797845CdA70B3C36
```

### Limitations

- Keep amounts **under 200** (limited testnet coins)
- Sends **0.001 Sepolia ETH** regardless of purchase amount
- ERC-20 purchases (like USDC) use MoonPay's test token, not real USDC
- `usdc_sol` (Solana USDC) is **not supported** in sandbox - use `eth` instead

### Test Cards

MoonPay uses **Revolut** as payment processor. Use Revolut test cards:

**Success Cards:**

| Brand | Number |
|-------|--------|
| Visa | `4929 4205 7359 5709` |
| Mastercard | `5281 4388 0180 4148` |

**Decline Cards:**

| Number | Scenario |
|--------|----------|
| `4929 5736 3812 5985` | Insufficient funds |
| `4532 3367 4387 4205` | Expired card |
| `4242 4242 4242 4242` | 3DS error (amount ≥£25) |

**CVV:** Any 3 digits | **Expiry:** Any future date

**SSN (if asked):** Any 9 digits (e.g., `123456789`)

> **⚠️ WARNING:** Never use real personal information in sandbox. Use fake data only.

Source: [Revolut Test Cards](https://developer.revolut.com/docs/guides/accept-payments/get-started/test-implementation/test-cards)

## Webhook

MoonPay sends transaction updates to: `POST /api/webhooks/moonpay`

### Events

| Event | Description |
|-------|-------------|
| `transaction_created` | User started purchase |
| `transaction_updated` | Status changed (pending, completed, failed) |

### Signature Verification

Webhooks are signed with HMAC-SHA256. Header: `Moonpay-Signature-V2`

```typescript
import { createHmac } from "crypto";

function verifySignature(payload: string, signature: string, key: string): boolean {
  const expected = createHmac("sha256", key)
    .update(payload)
    .digest("base64");
  return signature === expected;
}
```

## Frontend Widget

```tsx
import { MoonPayBuyWidget } from "@moonpay/moonpay-react";

<MoonPayBuyWidget
  variant="overlay"
  baseCurrencyCode="usd"
  baseCurrencyAmount="100"
  defaultCurrencyCode={import.meta.env.PROD ? "usdc_sol" : "eth"}
  walletAddress={depositAddress}
  visible={showWidget}
  onClose={async () => setShowWidget(false)}
/>
```

## Flow

```
1. User fills payment form
2. Frontend creates payment via API → gets deposit address
3. User clicks "Buy USDC" → MoonPay widget opens
4. User pays with card on MoonPay
5. MoonPay sends crypto to deposit address
6. MoonPay webhook notifies Furnel → updates payment status
7. Workflow continues to offramp
```

## Local Development

MoonPay can't send webhooks to localhost. Simulate them manually to test the full flow.

### Start Services

```bash
docker compose -f compose.development.yml up -d
```

### Create a Payment

1. Open `http://localhost`
2. Fill in payment form (amount, recipient details)
3. Click "Continue to Buy USDC"
4. Complete MoonPay widget flow with test card

### Simulate Webhook

MoonPay can't reach localhost, so simulate the webhook:

```bash
curl -X POST http://localhost/api/webhooks/moonpay \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transaction_updated",
    "data": {
      "status": "completed",
      "walletAddress": "0xc216eD2D6c295579718dbd4a797845CdA70B3C36",
      "cryptoTransactionId": "0xtest123abc"
    }
  }'
```

### Verify Flow

Check payment status:

```bash
docker compose -f compose.development.yml exec furnel-db psql -U furnel -d furnel \
  -c "SELECT id, status FROM payments ORDER BY created_at DESC LIMIT 5;"
```

Check worker logs:

```bash
docker compose -f compose.development.yml logs workers --tail 30
```

### Expected Flow (Mock Mode)

```
INITIATED
  ↓
WAITING_FOR_USDC  ← (webhook triggers this)
  ↓
USDC_RECEIVED
  ↓
FX_LOCKED
  ↓
GENERATING_OFFRAMP_URL
  ↓
AWAITING_USER_ACTION
  ↓
WAITING_FOR_OFFRAMP
  ↓
COMPLETED
```

In mock mode (`MOCK_MODE=true`), the workflow auto-completes. In production, user must complete Coinbase offramp.

## Resources

- [MoonPay Developer Docs](https://dev.moonpay.com/docs)
- [Sandbox Testing Guide](https://dev.moonpay.com/docs/faq-sandbox-testing)
- [React SDK](https://dev.moonpay.com/docs/moonpay-react)
- [Webhooks](https://dev.moonpay.com/docs/webhooks)
