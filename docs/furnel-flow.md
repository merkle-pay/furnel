# Furnel Cross-Border Payment Flow

## The Goal

**Sender wants to send:** $100 USD → **Recipient gets** £79 GBP in their UK bank account

---

## Key Insight: Who Clicks the Coinbase Link?

```
SENDER (pays)              FURNEL                 RECIPIENT (receives)
────────────              ───────                 ────────────────────

1. Pays $100 via
   MoonPay widget
   ──────────────────►

2. MoonPay sends USDC
   to Furnel's wallet
                           ◄──────────
                           USDC received

3. Furnel generates
   Coinbase offramp URL
                           ──────────────────────►
                                                    4. Recipient gets link
                                                       (via email)

                                                    5. Recipient clicks link
                                                       → Coinbase.com

                                                    6. Recipient logs in / KYCs
                                                       on Coinbase

                                                    7. Recipient confirms:
                                                       "Yes, deposit £79 to
                                                        MY bank account"

                                                    8. Coinbase sends £79
                                                       to recipient's bank ✓
```

### Why Recipient (Not Sender)?

| If SENDER clicks... | If RECIPIENT clicks... |
|---------------------|------------------------|
| Sender needs Coinbase account | Recipient needs Coinbase account |
| Sender enters recipient's bank? (can't - Coinbase only sends to verified owner) | Recipient's bank already linked to their Coinbase |
| Doesn't work | Works |

**Coinbase only sends money to bank accounts owned by the logged-in user.** So the recipient must be the one who clicks and completes.

---

## Why the Recipient Must Click a Coinbase Link

Coinbase Offramp is **NOT a pure API** — it's a redirect flow.

```
┌─────────────────────────────────────────────────────────────────┐
│                     WHY CAN'T WE AUTOMATE IT?                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Coinbase requires the RECIPIENT to:                            │
│                                                                 │
│  1. Log in to their Coinbase account                           │
│  2. Complete KYC (identity verification)                        │
│  3. Have their bank account linked to Coinbase                 │
│  4. Confirm "Yes, sell USDC and send £79 to MY bank"           │
│                                                                 │
│  We CANNOT do this on their behalf — it's their money!         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

| Option | Who handles money | License needed? |
|--------|-------------------|-----------------|
| **A. We custody funds** | Us | Yes - Money Transmitter License ($$$) |
| **B. Redirect to Coinbase** | Coinbase | No - we're just "orchestration" |

We chose **B** — Coinbase handles KYC, compliance, and money movement. We just connect the dots.

---

## Phase 1: Payment Initiation (Browser - Sender)

- **Sender opens** `http://localhost` (React frontend)
- **Sender fills form:**
  - Amount: `$100`
  - Recipient name: `John Doe`
  - Recipient email: `john@example.com` ← **Used to send Coinbase link**
  - Currency: `GBP`
- **Sender clicks** "Continue"
- **Frontend calls:** `POST /api/payments`
  ```json
  {
    "amount": 100,
    "currency": "GBP",
    "recipientName": "John Doe",
    "recipientEmail": "john@example.com"
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
  INSERT INTO payments (id, deposit_address, amount, currency, recipient_email, status, ...)
  VALUES ('pay_abc123', '0xc216...', 100, 'GBP', 'john@example.com', 'INITIATED', ...)
  ```
- **API starts** Temporal workflow:
  ```typescript
  await temporalClient.workflow.start(paymentWorkflow, {
    workflowId: 'pay_abc123',
    args: [{ paymentId, amount, currency, depositAddress, recipientEmail, ... }]
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

## Phase 4: Sender Buys USDC (Browser + MoonPay)

- **Frontend shows** "Buy USDC" button + MoonPay widget to **Sender**
- **Sender clicks** "Buy USDC"
- **MoonPay widget opens** (iframe/popup):
  ```tsx
  <MoonPayBuyWidget
    baseCurrencyAmount="100"      // $100 USD
    defaultCurrencyCode="usdc_sol" // Buy USDC on Solana
    walletAddress="0xc216..."      // Send to Furnel's address
  />
  ```
- **Sender in MoonPay widget:**
  - Selects "Credit/Debit Card"
  - Enters card: `4929 4205 7359 5709` (test card)
  - Enters CVV: `123`
  - Completes 3DS verification (if prompted)
  - Clicks "Buy"
- **MoonPay processes** payment:
  - Charges sender's card $100 + fees
  - Converts USD → USDC
  - Sends USDC to `0xc216...` on Solana blockchain
- **Sender's job is done!** They can close the browser.

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
- **Workflow stores** `offrampUrl` in state
- **Workflow updates** status → `SENDING_RECIPIENT_EMAIL`

---

## Phase 9: Send Email to Recipient (Worker)

- **Workflow calls** activity: `sendOfframpEmail(recipientEmail, offrampUrl, amount, currency)`
- **Activity sends** email to recipient:
  ```
  To: john@example.com
  Subject: You've received $100 USD - Complete your transfer

  Hi John,

  Someone has sent you $100 USD (approximately £79 GBP).

  To receive this money in your bank account, click the link below
  and complete the process on Coinbase:

  [Complete Transfer on Coinbase]
  https://pay.coinbase.com/sell?quote=quote_xyz

  This link expires in 24 hours.

  - Furnel Team
  ```
- **Workflow updates** status → `AWAITING_RECIPIENT_ACTION`

---

## Phase 10: Recipient Completes Offramp (Browser + Coinbase)

- **Recipient receives** email and **clicks** the Coinbase link
- **Recipient is redirected** to `https://pay.coinbase.com/sell?quote=quote_xyz`
- **Recipient on Coinbase website:**
  - Logs in / creates Coinbase account (if needed)
  - Completes KYC (if needed)
  - Confirms their bank account is linked
  - Sees: "Receive £79.00 GBP to Lloyds ****1234"
  - Clicks "Confirm"
- **Coinbase:**
  - Takes USDC from Furnel's deposit address
  - Initiates bank transfer to recipient's UK bank account
  - Redirects recipient to: `http://localhost/api/webhooks/coinbase/callback?quote_id=quote_xyz&status=success`

```
┌────────────────────────────────────────────────────┐
│                   COINBASE.COM                      │
├────────────────────────────────────────────────────┤
│                                                     │
│  You're receiving a payment!                        │
│                                                     │
│  Amount: 100 USDC → £79.00 GBP                     │
│                                                     │
│  Deposit to: Lloyds Bank ****1234                  │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │            Confirm & Receive                │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
└────────────────────────────────────────────────────┘
```

---

## Phase 11: Coinbase Callback (API Server)

- **Browser redirects** to `GET /api/webhooks/coinbase/callback?quote_id=quote_xyz&status=success`
- **API updates** database:
  ```sql
  UPDATE payments
  SET offramp_callback_status = 'success', offramp_callback_at = NOW()
  WHERE quote_id = 'quote_xyz'
  ```
- **API redirects** recipient to frontend: `http://localhost/payment/success?quote_id=quote_xyz`

---

## Phase 12: Coinbase Webhook (API Server)

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

## Phase 13: Workflow Completes (Worker)

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

## Phase 14: Recipient Gets Money

- **1-3 business days later:**
- **Recipient's UK bank account** receives £79 GBP
- **Recipient sees:** "Transfer from Coinbase" or similar
- **Recipient has no idea** USDC was involved — it's invisible

---

## Complete Flow Diagram

```
SENDER                      FURNEL                      RECIPIENT
──────                      ──────                      ─────────

1. Fill form
   (amount, recipient email)
   ─────────────────────────►

2. Pay $100 via MoonPay
   ─────────────────────────►

3. SENDER IS DONE ✓          4. Receive USDC
                              5. Generate Coinbase URL
                              6. Send email to recipient
                              ─────────────────────────────────►

                                                        7. Receive email
                                                        8. Click Coinbase link
                                                        9. Log in to Coinbase
                                                        10. Confirm transfer
                                                        11. RECIPIENT IS DONE ✓

                              12. Receive webhook
                              13. Mark COMPLETED

                                                        14. Receive £79 in bank
                                                            (1-3 days later)
```

---

## State Transitions Summary

```
INITIATED                    ← Payment created
    ↓
WAITING_FOR_USDC            ← Waiting for MoonPay (sender paying)
    ↓
USDC_RECEIVED               ← MoonPay webhook confirmed
    ↓
LOCKING_FX                  ← Getting exchange rate
    ↓
FX_LOCKED                   ← Rate locked (5 min expiry)
    ↓
GENERATING_OFFRAMP_URL      ← Calling Coinbase API
    ↓
SENDING_RECIPIENT_EMAIL     ← Emailing Coinbase link to recipient
    ↓
AWAITING_RECIPIENT_ACTION   ← Waiting for recipient to click link
    ↓
WAITING_FOR_OFFRAMP         ← Recipient on Coinbase, completing sale
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
| Recipient Email | `john@example.com` | Where Coinbase link is sent |
