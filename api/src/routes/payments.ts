import { Hono } from "hono";
import { Client, Connection } from "@temporalio/client";
import { pool } from "../lib/db.js";

export const paymentRoutes = new Hono();

// Temporal client (lazy initialized)
let temporalClient: Client | null = null;

async function getTemporalClient(): Promise<Client> {
  if (!temporalClient) {
    const connection = await Connection.connect({
      address: "temporal:7233",
    });
    temporalClient = new Client({ connection });
  }
  return temporalClient;
}

// Create a new payment
paymentRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const {
    amount,
    currency,
    recipientName,
    recipientEmail,
    recipientAccountNumber,
    recipientSortCode,
    recipientIban,
  } = body;

  if (!amount || !currency) {
    return c.json(
      { error: "Missing required fields: amount, currency" },
      400
    );
  }

  if (!recipientEmail) {
    return c.json(
      { error: "Missing required field: recipientEmail (needed to send Coinbase link)" },
      400
    );
  }

  try {
    const client = await getTemporalClient();
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Generate a deposit address (in production, this would be a unique Solana address)
    // For now, use a placeholder - you'd integrate with a wallet service
    const depositAddress = process.env.FURNEL_DEPOSIT_ADDRESS || "PLACEHOLDER_DEPOSIT_ADDRESS";

    // Redirect URL after user completes offramp
    const redirectUrl =
      process.env.REDIRECT_URL || "http://localhost/api/webhooks/coinbase/callback";

    // Insert payment record
    await pool.query(
      `INSERT INTO payments (
        id, deposit_address, amount, currency, status,
        recipient_name, recipient_email, recipient_account_number, recipient_sort_code, recipient_iban,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'INITIATED', $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        paymentId,
        depositAddress,
        amount,
        currency,
        recipientName,
        recipientEmail,
        recipientAccountNumber,
        recipientSortCode,
        recipientIban,
      ]
    );

    // Start the payment workflow
    const handle = await client.workflow.start("paymentWorkflow", {
      taskQueue: "furnel-queue",
      workflowId: paymentId,
      args: [
        {
          paymentId,
          amount,
          currency,
          depositAddress,
          redirectUrl,
          recipientEmail,
          recipientBankDetails: {
            name: recipientName,
            accountNumber: recipientAccountNumber,
            sortCode: recipientSortCode,
            iban: recipientIban,
          },
        },
      ],
    });

    // Update with workflow ID
    await pool.query(
      "UPDATE payments SET workflow_id = $2 WHERE id = $1",
      [paymentId, handle.workflowId]
    );

    return c.json({
      paymentId,
      workflowId: handle.workflowId,
      depositAddress,
      amount,
      currency,
      status: "INITIATED",
      message: "Send USDC to the deposit address to proceed",
    });
  } catch (error) {
    console.error("Failed to start payment workflow:", error);
    return c.json({ error: "Failed to initiate payment" }, 500);
  }
});

// Get payment status
paymentRoutes.get("/:paymentId", async (c) => {
  const paymentId = c.req.param("paymentId");

  try {
    // Get from database
    const result = await pool.query(
      `SELECT
        id, user_wallet_address, deposit_address, amount, currency, status,
        recipient_name, recipient_email, fx_rate, quote_id, offramp_url, offramp_order_id,
        error_message, workflow_id, created_at, updated_at
       FROM payments WHERE id = $1`,
      [paymentId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Payment not found" }, 404);
    }

    const payment = result.rows[0];

    // Also get workflow status from Temporal
    let workflowStatus = null;
    if (payment.workflow_id) {
      try {
        const client = await getTemporalClient();
        const handle = client.workflow.getHandle(payment.workflow_id);
        const description = await handle.describe();
        workflowStatus = {
          status: description.status.name,
          startTime: description.startTime,
          closeTime: description.closeTime,
        };
      } catch {
        // Workflow might not exist yet
      }
    }

    return c.json({
      ...payment,
      workflow: workflowStatus,
    });
  } catch (error) {
    console.error("Failed to get payment status:", error);
    return c.json({ error: "Failed to get payment" }, 500);
  }
});

// List recent payments
paymentRoutes.get("/", async (c) => {
  try {
    const result = await pool.query(
      `SELECT id, amount, currency, status, created_at
       FROM payments
       ORDER BY created_at DESC
       LIMIT 50`
    );

    return c.json({ payments: result.rows });
  } catch (error) {
    console.error("Failed to list payments:", error);
    return c.json({ error: "Failed to list payments" }, 500);
  }
});
