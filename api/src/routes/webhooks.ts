import { Hono } from "hono";
import { createHmac } from "crypto";
import { pool } from "../lib/db.js";

export const webhookRoutes = new Hono();

// Verify MoonPay webhook signature
function verifyMoonPaySignature(
  payload: string,
  signature: string | undefined,
  webhookKey: string
): boolean {
  if (!signature || !webhookKey) return false;

  const expectedSignature = createHmac("sha256", webhookKey)
    .update(payload)
    .digest("base64");

  return signature === expectedSignature;
}

// MoonPay webhook - receives transaction notifications
webhookRoutes.post("/moonpay", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("Moonpay-Signature-V2");
  const webhookKey = process.env.MOONPAY_WEBHOOK_KEY;

  // Verify signature in production
  if (webhookKey && !verifyMoonPaySignature(rawBody, signature, webhookKey)) {
    console.error("MoonPay webhook signature verification failed");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const body = JSON.parse(rawBody);
  console.log("MoonPay webhook received:", JSON.stringify(body, null, 2));

  const { type, data } = body;

  try {
    // MoonPay sends the wallet address in data.walletAddress
    // This matches our deposit_address
    const walletAddress = data.walletAddress;
    const status = data.status;
    const txHash = data.cryptoTransactionId;

    switch (type) {
      case "transaction_created":
        console.log(`MoonPay transaction created for ${walletAddress}`);
        break;

      case "transaction_updated":
        if (status === "completed") {
          // USDC received! Update payment status
          await pool.query(
            `UPDATE payments
             SET status = 'USDC_RECEIVED',
                 usdc_tx_hash = $2,
                 usdc_received_at = NOW(),
                 updated_at = NOW()
             WHERE deposit_address = $1 AND status = 'WAITING_FOR_USDC'`,
            [walletAddress, txHash]
          );
          console.log(`Payment updated: USDC received at ${walletAddress}`);
        } else if (status === "failed") {
          await pool.query(
            `UPDATE payments
             SET status = 'USDC_FAILED',
                 error_message = $2,
                 updated_at = NOW()
             WHERE deposit_address = $1 AND status = 'WAITING_FOR_USDC'`,
            [walletAddress, data.failureReason || "MoonPay transaction failed"]
          );
          console.log(`Payment failed: ${walletAddress}`);
        }
        break;

      default:
        console.log(`Unknown MoonPay event type: ${type}`);
    }

    // Log webhook event
    await pool.query(
      `INSERT INTO webhook_events (provider, event_type, payload, processed, created_at)
       VALUES ('moonpay', $1, $2, true, NOW())`,
      [type, rawBody]
    );

    return c.json({ received: true });
  } catch (error) {
    console.error("MoonPay webhook processing error:", error);
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

// Coinbase Offramp webhook
// Called when offramp transaction status changes
webhookRoutes.post("/coinbase", async (c) => {
  const body = await c.req.json();

  console.log("Coinbase webhook received:", JSON.stringify(body, null, 2));

  // Verify webhook signature (TODO: implement signature verification)
  // const signature = c.req.header("x-coinbase-signature");

  const { event_type, data } = body;

  try {
    switch (event_type) {
      case "offramp.completed":
        // Transaction completed successfully
        await pool.query(
          `UPDATE payments
           SET status = 'DELIVERED',
               offramp_completed_at = NOW(),
               updated_at = NOW()
           WHERE offramp_order_id = $1`,
          [data.order_id]
        );
        break;

      case "offramp.failed":
        // Transaction failed
        await pool.query(
          `UPDATE payments
           SET status = 'OFFRAMP_FAILED',
               error_message = $2,
               updated_at = NOW()
           WHERE offramp_order_id = $1`,
          [data.order_id, data.failure_reason || "Unknown error"]
        );
        break;

      case "offramp.pending":
        // Transaction is processing
        await pool.query(
          `UPDATE payments
           SET status = 'OFFRAMPING',
               updated_at = NOW()
           WHERE offramp_order_id = $1`,
          [data.order_id]
        );
        break;

      default:
        console.log(`Unknown event type: ${event_type}`);
    }

    // Log webhook event
    await pool.query(
      `INSERT INTO webhook_events (provider, event_type, payload, created_at)
       VALUES ('coinbase', $1, $2, NOW())`,
      [event_type, JSON.stringify(body)]
    );

    return c.json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

// Offramp redirect callback
// User is redirected here after completing offramp on Coinbase
webhookRoutes.get("/coinbase/callback", async (c) => {
  const quoteId = c.req.query("quote_id");
  const status = c.req.query("status");

  console.log(`Coinbase callback: quote_id=${quoteId}, status=${status}`);

  if (!quoteId) {
    return c.json({ error: "Missing quote_id" }, 400);
  }

  try {
    // Update payment with callback info
    await pool.query(
      `UPDATE payments
       SET offramp_callback_status = $2,
           offramp_callback_at = NOW(),
           updated_at = NOW()
       WHERE quote_id = $1`,
      [quoteId, status]
    );

    // Redirect to frontend success/failure page
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
    if (status === "success") {
      return c.redirect(`${frontendUrl}/payment/success?quote_id=${quoteId}`);
    } else {
      return c.redirect(`${frontendUrl}/payment/failed?quote_id=${quoteId}`);
    }
  } catch (error) {
    console.error("Callback processing error:", error);
    return c.json({ error: "Callback processing failed" }, 500);
  }
});
