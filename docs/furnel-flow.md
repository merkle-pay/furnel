# Furnel Cross-Border Payment Flow

## The Goal

**User wants to send:** $100 USD → Recipient gets £79 GBP in their UK bank account

---

## Phase 1: Payment Initiation (Browser)

- **User opens** `http://localhost` (React frontend)
- **User fills form:**
  - Amount: `$100`
  - Recipient name: `John Doe`
  - Recipient bank: Sort code `12-34-56`, Account `12345678`
  - Currency: `GBP`
- **User clicks** "Continue"
- **Frontend calls:** `POST /api/payments`
  ```json
  {
    "amount": 100,
    "currency": "GBP",
    "recipientName": "John Doe",
    "recipientAccountNumber": "12345678",
    "recipientSortCode": "12-34-56"
  }
  ```

---

## Phase 2: Payment Record Created (API Server)

- **API receives** POST request
- **API generates** unique payment ID: `pay_abc123`
- **API assigns** deposit address: `0xc216eD2D6c295579718dbd4a797845CdA70B3C36`
  - This is Furnel's Solana wallet that will receive USDC
- **API inserts** into PostgreSQL:
  ```sql
  INSERT INTO payments (id, deposit_address, amount, currency, status, ...)
  VALUES ('pay_abc123', '0xc216...', 100, 'GBP', 'INITIATED', ...)
  ```
- **API starts** Temporal workflow:
  ```typescript
  await temporalClient.workflow.start(paymentWorkflow, {
    workflowId: 'pay_abc123',
    args: [{ paymentId, amount, currency, depositAddress, ... }]
  })
  ```
- **API returns** to frontend:
  ```json
  {
    "paymentId": "pay_abc123",
    "depositAddress": "0xc216eD2D6c295579718dbd4a797845CdA70B3C36",
    "status": "INITIATED"
  }
  ```

---

## Phase 3: Temporal Workflow Starts (Worker)

- **Workflow begins** `paymentWorkflow(input)`
- **Workflow updates** status → `WAITING_FOR_USDC`
- **Workflow spawns** child workflow: `onrampWorkflow`
- **Child workflow starts** polling Solana RPC for USDC balance at deposit address
- **Workflow is now PAUSED** — waiting for USDC to arrive

---

## Phase 4: User Buys USDC (Browser + MoonPay)

- **Frontend shows** "Buy USDC" button + MoonPay widget
- **User clicks** "Buy USDC"
- **MoonPay widget opens** (iframe/popup):
  ```tsx
  <MoonPayBuyWidget
    baseCurrencyAmount="100"      // $100 USD
    defaultCurrencyCode="usdc_sol" // Buy USDC on Solana
    walletAddress="0xc216..."      // Send to Furnel's address
  />
  ```
- **User in MoonPay widget:**
  - Selects "Credit/Debit Card"
  - Enters card: `4929 4205 7359 5709` (test card)
  - Enters CVV: `123`
  - Completes 3DS verification (if prompted)
  - Clicks "Buy"
- **MoonPay processes** payment:
  - Charges user's card $100 + fees
  - Converts USD → USDC
  - Sends USDC to `0xc216...` on Solana blockchain

---

## Phase 5: MoonPay Webhook (API Server)

- **MoonPay sends** webhook to `POST /api/webhooks/moonpay`:
  ```json
  {
    "type": "transaction_updated",
    "data": {
      "status": "completed",
      "walletAddress": "0xc216eD2D6c295579718dbd4a797845CdA70B3C36",
      "cryptoTransactionId": "5xYz...abc"
    }
  }
  ```
- **API verifies** signature:
  ```typescript
  signature = HMAC-SHA256(MOONPAY_WEBHOOK_SIGNING_KEY, timestamp + "." + body)
  ```
- **API updates** database:
  ```sql
  UPDATE payments
  SET status = 'USDC_RECEIVED', usdc_tx_hash = '5xYz...abc'
  WHERE deposit_address = '0xc216...'
  ```

---

## Phase 6: Workflow Detects USDC (Worker)

- **Child workflow** `onrampWorkflow` was polling Solana RPC:
  ```typescript
  // Every 5 seconds:
  const balance = await solanaConnection.getParsedTokenAccountsByOwner(
    depositAddress,
    { mint: USDC_MINT }
  );
  // balance >= 100 USDC? → Return success
  ```
- **Child workflow returns:** `{ success: true, txHash: "5xYz...abc", amount: 100 }`
- **Parent workflow continues** to next step

---

## Phase 7: Lock FX Rate (Worker)

- **Workflow updates** status → `LOCKING_FX`
- **Workflow calls** activity: `lockFXRate("GBP")`
- **Activity returns:** `{ rate: 0.79, expiresAt: "5 minutes from now" }`
  - Currently mocked; production would call Coinbase quote API
- **Workflow records** compensation step:
  ```typescript
  compensationHistory.push({ action: "FX_LOCKED", ... })
  ```
- **Workflow updates** status → `FX_LOCKED`

---

## Phase 8: Generate Offramp URL (Worker)

- **Workflow updates** status → `GENERATING_OFFRAMP_URL`
- **Workflow calls** activity: `generateOfframpURL(100, "GBP", ...)`
- **Activity calls** Coinbase CDP API:
  ```typescript
  POST https://api.developer.coinbase.com/onramp/v1/sell/quote
  Authorization: Bearer <JWT signed with Ed25519 key>
  {
    "sell_currency": "USDC",
    "sell_amount": "100",
    "cashout_currency": "GBP",
    "payment_method": "BANK_ACCOUNT",
    "redirect_url": "http://localhost/api/webhooks/coinbase/callback"
  }
  ```
- **Coinbase returns:**
  ```json
  {
    "offramp_url": "https://pay.coinbase.com/sell?quote=quote_xyz",
    "quote_id": "quote_xyz",
    "exchange_rate": "0.79"
  }
  ```
- **Workflow updates** status → `AWAITING_USER_ACTION`
- **Workflow stores** `offrampUrl` in state

---

## Phase 9: User Completes Offramp (Browser + Coinbase)

- **Frontend shows** "Complete on Coinbase" button with the offramp URL
- **User clicks** → Redirected to `https://pay.coinbase.com/sell?quote=quote_xyz`
- **User on Coinbase website:**
  - Logs in / creates Coinbase account
  - Completes KYC if needed
  - Enters recipient bank details (or confirms pre-filled)
  - Confirms the sale: 100 USDC → £79 GBP
  - Clicks "Confirm"
- **Coinbase:**
  - Takes USDC from Furnel's deposit address
  - Initiates bank transfer to recipient's UK bank account
  - Redirects user to: `http://localhost/api/webhooks/coinbase/callback?quote_id=quote_xyz&status=success`

---

## Phase 10: Coinbase Callback (API Server)

- **Browser redirects** to `GET /api/webhooks/coinbase/callback?quote_id=quote_xyz&status=success`
- **API updates** database:
  ```sql
  UPDATE payments
  SET offramp_callback_status = 'success', offramp_callback_at = NOW()
  WHERE quote_id = 'quote_xyz'
  ```
- **API redirects** user to frontend: `http://localhost/payment/success?quote_id=quote_xyz`

---

## Phase 11: Coinbase Webhook (API Server)

- **Coinbase sends** webhook when bank transfer completes:
  ```
  POST /api/webhooks/coinbase
  Header: x-coinbase-signature: <signature>
  {
    "event_type": "offramp.completed",
    "data": {
      "order_id": "order_abc",
      "quote_id": "quote_xyz"
    }
  }
  ```
- **API verifies** signature:
  ```typescript
  signature = HMAC-SHA256(COINBASE_WEBHOOK_ID, body)
  ```
- **API updates** database:
  ```sql
  UPDATE payments SET status = 'DELIVERED' WHERE offramp_order_id = 'order_abc'
  ```

---

## Phase 12: Workflow Completes (Worker)

- **Workflow** was polling database in `confirmDelivery(quoteId)`:
  ```typescript
  // Every 5 minutes:
  SELECT status FROM payments WHERE quote_id = 'quote_xyz'
  // status === 'DELIVERED'? → Return true
  ```
- **Workflow updates** status → `COMPLETED`
- **Workflow returns** final state:
  ```typescript
  {
    status: "COMPLETED",
    usdcReceived: true,
    fxRate: 0.79,
    deliveryConfirmed: true
  }
  ```

---

## Phase 13: Recipient Gets Money

- **1-3 business days later:**
- **Recipient's UK bank account** receives £79 GBP
- **Recipient sees:** "Transfer from Coinbase" or similar
- **Recipient has no idea** USDC was involved — it's invisible

---

## State Transitions Summary

```
INITIATED                    ← Payment created
    ↓
WAITING_FOR_USDC            ← Waiting for MoonPay
    ↓
USDC_RECEIVED               ← MoonPay webhook confirmed
    ↓
LOCKING_FX                  ← Getting exchange rate
    ↓
FX_LOCKED                   ← Rate locked (5 min expiry)
    ↓
GENERATING_OFFRAMP_URL      ← Calling Coinbase API
    ↓
AWAITING_USER_ACTION        ← User must click Coinbase link
    ↓
WAITING_FOR_OFFRAMP         ← User on Coinbase, completing sale
    ↓
DELIVERED                   ← Coinbase webhook confirmed
    ↓
COMPLETED                   ← Workflow finished
```

---

## If Something Goes Wrong

```
Any failure after USDC_RECEIVED:
    ↓
COMPENSATING                ← Saga rollback starts
    ↓
REFUNDED                    ← USDC returned (currently manual)
```

---

## Key Addresses & IDs

| Item | Example Value | Where It's Used |
|------|---------------|-----------------|
| Payment ID | `pay_abc123` | Database, Temporal workflow ID |
| Deposit Address | `0xc216eD...` | MoonPay sends USDC here |
| USDC TX Hash | `5xYz...abc` | Solana transaction proof |
| Quote ID | `quote_xyz` | Coinbase offramp tracking |
| Order ID | `order_abc` | Coinbase delivery tracking |
