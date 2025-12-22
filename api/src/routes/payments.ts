import { Hono } from "hono";
import { Client, Connection } from "@temporalio/client";

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
  const { amount, currency, recipientId } = body;

  if (!amount || !currency || !recipientId) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  try {
    const client = await getTemporalClient();
    const workflowId = `payment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Start the payment workflow
    const handle = await client.workflow.start("paymentWorkflow", {
      taskQueue: "furnel-queue",
      workflowId,
      args: [{ amount, currency, recipientId }],
    });

    return c.json({
      workflowId: handle.workflowId,
      status: "initiated",
      message: "Payment workflow started",
    });
  } catch (error) {
    console.error("Failed to start payment workflow:", error);
    return c.json({ error: "Failed to initiate payment" }, 500);
  }
});

// Get payment status
paymentRoutes.get("/:workflowId", async (c) => {
  const workflowId = c.req.param("workflowId");

  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    const description = await handle.describe();

    return c.json({
      workflowId,
      status: description.status.name,
      startTime: description.startTime,
      closeTime: description.closeTime,
    });
  } catch (error) {
    console.error("Failed to get payment status:", error);
    return c.json({ error: "Payment not found" }, 404);
  }
});

// List recent payments
paymentRoutes.get("/", async (c) => {
  // TODO: Query from database
  return c.json({
    payments: [],
    message: "TODO: Implement database query",
  });
});
