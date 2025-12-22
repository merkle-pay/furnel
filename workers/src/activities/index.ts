// Furnel Activities
// USDC → Local Currency Offramp

import { Connection, PublicKey } from "@solana/web3.js";
import { SignJWT, importPKCS8 } from "jose";
import { Pool } from "pg";

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || "furnel-db",
  user: process.env.DB_USER || "furnel",
  database: process.env.DB_NAME || "furnel",
  password: process.env.POSTGRES_PASSWORD,
  port: 5432,
});

// Solana connection (mainnet for production, devnet for testing)
const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const solanaConnection = new Connection(SOLANA_RPC);

// USDC token mint address (Solana mainnet)
const USDC_MINT = new PublicKey(
  process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

// Coinbase CDP API
const CDP_API_URL = "https://api.developer.coinbase.com";

interface CoinbaseQuoteResponse {
  offramp_url: string;
  quote_id: string;
  sell_amount: { value: string; currency: string };
  cashout_amount: { value: string; currency: string };
  exchange_rate: string;
  expires_at: string;
}

// Generate JWT for Coinbase CDP API
async function generateCDPToken(): Promise<string> {
  const keyName = process.env.CDP_API_KEY_NAME;
  const privateKey = process.env.CDP_API_KEY_PRIVATE_KEY;

  if (!keyName || !privateKey) {
    throw new Error("CDP_API_KEY_NAME and CDP_API_KEY_PRIVATE_KEY required");
  }

  // Import the private key
  const key = await importPKCS8(privateKey.replace(/\\n/g, "\n"), "ES256");

  // Generate JWT
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyName, typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .setSubject(keyName)
    .setAudience("cdp_service")
    .sign(key);

  return token;
}

// Activity: Wait for USDC deposit on Solana
export async function waitForUSDC(
  depositAddress: string,
  expectedAmount: number
): Promise<{ txHash: string; amount: number }> {
  console.log(`Waiting for ${expectedAmount} USDC at ${depositAddress}`);

  const depositPubkey = new PublicKey(depositAddress);

  // Poll for USDC balance
  const maxAttempts = 60; // 5 minutes with 5s intervals
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Get token accounts for this address
      const tokenAccounts = await solanaConnection.getParsedTokenAccountsByOwner(
        depositPubkey,
        { mint: USDC_MINT }
      );

      if (tokenAccounts.value.length > 0) {
        const balance =
          tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;

        if (balance >= expectedAmount) {
          // Get recent transaction signature
          const signatures = await solanaConnection.getSignaturesForAddress(
            depositPubkey,
            { limit: 1 }
          );

          const txHash = signatures[0]?.signature || `detected_${Date.now()}`;
          console.log(`USDC received: ${balance} (tx: ${txHash})`);

          return { txHash, amount: balance };
        }
      }
    } catch (error) {
      console.error(`Error checking balance (attempt ${attempt}):`, error);
    }

    // Wait 5 seconds before next poll
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`USDC deposit timeout after ${maxAttempts} attempts`);
}

// Activity: Lock FX rate via Coinbase quote
export async function lockFXRate(
  targetCurrency: string
): Promise<{ rate: number; expiresAt: Date }> {
  console.log(`Locking FX rate for USDC → ${targetCurrency}`);

  // For now, use mock rates since we need full quote flow
  // TODO: Integrate with Coinbase quote API when we have user context
  const rates: Record<string, number> = {
    GBP: 0.79,
    EUR: 0.92,
    USD: 1.0,
    PHP: 56.5,
    NGN: 1550,
    BRL: 4.95,
  };

  const rate = rates[targetCurrency] || 1;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

  console.log(`FX rate locked: 1 USDC = ${rate} ${targetCurrency}`);
  return { rate, expiresAt };
}

// Activity: Generate Coinbase Offramp URL
export async function generateOfframpURL(
  amount: number,
  currency: string,
  sourceAddress: string,
  partnerUserId: string,
  redirectUrl: string
): Promise<{ offrampUrl: string; quoteId: string; expiresAt: Date }> {
  console.log(`Generating offramp URL for ${amount} USDC → ${currency}`);

  const token = await generateCDPToken();

  const response = await fetch(`${CDP_API_URL}/onramp/v1/sell/quote`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sell_currency: "USDC",
      sell_amount: amount.toString(),
      cashout_currency: currency,
      payment_method: "BANK_ACCOUNT",
      country: "US", // TODO: Make configurable
      source_address: sourceAddress,
      redirect_url: redirectUrl,
      partner_user_id: partnerUserId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Coinbase quote failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as CoinbaseQuoteResponse;

  console.log(`Offramp URL generated: ${data.quote_id}`);
  return {
    offrampUrl: data.offramp_url,
    quoteId: data.quote_id,
    expiresAt: new Date(data.expires_at),
  };
}

// Activity: Execute offramp (legacy - now generates URL)
export async function executeOfframp(
  amount: number,
  currency: string,
  recipientBankDetails: {
    name: string;
    accountNumber: string;
    sortCode?: string;
    iban?: string;
  }
): Promise<{ orderId: string; estimatedArrival: Date }> {
  console.log(
    `Executing offramp: ${amount} ${currency} to ${recipientBankDetails.name}`
  );

  // Note: In the redirect flow, the actual offramp happens on Coinbase's side
  // This activity is now mostly for tracking purposes

  const orderId = `offramp_${Date.now()}`;
  const estimatedArrival = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  console.log(`Offramp order created: ${orderId}`);
  return { orderId, estimatedArrival };
}

// Activity: Confirm delivery (check webhook or poll)
export async function confirmDelivery(orderId: string): Promise<boolean> {
  console.log(`Confirming delivery for order ${orderId}`);

  // Check database for webhook confirmation
  const result = await pool.query(
    "SELECT status FROM payments WHERE offramp_order_id = $1",
    [orderId]
  );

  if (result.rows.length > 0 && result.rows[0].status === "DELIVERED") {
    console.log(`Delivery confirmed`);
    return true;
  }

  // Poll for confirmation (max 24 hours with 5 min intervals)
  const maxAttempts = 288;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checkResult = await pool.query(
      "SELECT status FROM payments WHERE offramp_order_id = $1",
      [orderId]
    );

    if (
      checkResult.rows.length > 0 &&
      checkResult.rows[0].status === "DELIVERED"
    ) {
      console.log(`Delivery confirmed after ${attempt} polls`);
      return true;
    }

    // Wait 5 minutes
    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
  }

  throw new Error(`Delivery confirmation timeout for ${orderId}`);
}

// Compensation: Refund USDC
export async function refundUSDC(
  amount: number,
  userWalletAddress: string
): Promise<string> {
  console.log(`Refunding ${amount} USDC to ${userWalletAddress}`);

  // TODO: Implement actual Solana USDC transfer
  // This requires having a funded wallet with USDC to send back
  // For now, log and create a manual refund ticket

  const txHash = `refund_pending_${Date.now()}`;
  console.log(`Refund queued: ${txHash}`);

  // Record refund in database
  await pool.query(
    `INSERT INTO refunds (wallet_address, amount, status, created_at)
     VALUES ($1, $2, 'PENDING', NOW())`,
    [userWalletAddress, amount]
  );

  return txHash;
}

// Activity: Update payment status in database
export async function updatePaymentStatus(
  paymentId: string,
  status: string
): Promise<void> {
  console.log(`Payment ${paymentId} → ${status}`);

  await pool.query(
    `UPDATE payments SET status = $2, updated_at = NOW() WHERE id = $1`,
    [paymentId, status]
  );

  // Record state transition
  await pool.query(
    `INSERT INTO payment_state_transitions (payment_id, status, created_at)
     VALUES ($1, $2, NOW())`,
    [paymentId, status]
  );
}
