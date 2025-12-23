// Furnel Activities
// USDC → Local Currency Offramp

import { Connection, PublicKey } from "@solana/web3.js";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
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
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Coinbase CDP API
const CDP_API_URL = "https://api.developer.coinbase.com";

// MoonPay test deposit address (Sepolia)
const MOONPAY_DEPOSIT_ADDRESS = process.env.MOONPAY_DEPOSIT_ADDRESS;

interface CoinbaseQuoteResponse {
  offramp_url: string;
  quote_id: string;
  sell_amount: { value: string; currency: string };
  cashout_amount: { value: string; currency: string };
  exchange_rate: string;
  expires_at: string;
}

// Generate JWT for Coinbase CDP API using official SDK
async function generateCDPToken(requestPath: string, requestMethod: string = "POST"): Promise<string> {
  const projectId = process.env.CDP_PROJECT_ID;
  const keyId = process.env.CDP_API_KEY_ID;
  const privateKey = process.env.CDP_API_KEY_PRIVATE_KEY;

  if (!projectId || !keyId || !privateKey) {
    throw new Error("CDP_PROJECT_ID, CDP_API_KEY_ID, and CDP_API_KEY_PRIVATE_KEY required");
  }

  // API key ID should be in full path format per CDP docs
  const apiKeyId = `organizations/${projectId}/apiKeys/${keyId}`;

  console.log(`Generating JWT for ${requestMethod} ${requestPath} with key ${apiKeyId}`);

  // Use the official CDP SDK to generate JWT
  // Supports both Ed25519 (base64) and EC (PEM) key formats automatically
  const token = await generateJwt({
    apiKeyId,
    apiKeySecret: privateKey,
    requestMethod,
    requestHost: "api.developer.coinbase.com",
    requestPath,
    expiresIn: 120,
  });

  return token;
}

// Helper: Get recent transactions on Sepolia (any direction)
async function getSepoliaTxs(address: string): Promise<Array<{ hash: string; value: string; timeStamp: string; from: string; to: string }>> {
  // Use Blockscout API (Etherscan V1 is deprecated)
  const response = await fetch(
    `https://eth-sepolia.blockscout.com/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=20`
  );
  const data = await response.json() as {
    result: Array<{ hash: string; value: string; timeStamp: string; from: string; to: string }>
  };
  return data.result || [];
}

// Activity: Wait for deposit (ETH on Sepolia for test, USDC on Solana for prod)
export async function waitForUSDC(
  depositAddress: string,
  expectedAmount: number
): Promise<{ txHash: string; amount: number }> {
  // Test mode: detect ETH on Sepolia (MoonPay sandbox sends ETH)
  if (MOONPAY_DEPOSIT_ADDRESS) {
    console.log(`[TEST MODE] Waiting for new transaction on Sepolia at ${MOONPAY_DEPOSIT_ADDRESS}`);
    console.log(`  (MoonPay will trigger a transaction, then we use Solana USDC for Coinbase)`);

    // Get initial transactions to know what's already there
    const initialTxs = await getSepoliaTxs(MOONPAY_DEPOSIT_ADDRESS);
    const initialTxHashes = new Set(initialTxs.map(tx => tx.hash));
    console.log(`  Found ${initialTxs.length} existing transactions`);
    if (initialTxs.length > 0) {
      console.log(`  Latest tx: ${initialTxs[0].hash}`);
    }

    const maxAttempts = 120; // 10 minutes with 5s intervals
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const currentTxs = await getSepoliaTxs(MOONPAY_DEPOSIT_ADDRESS);

        if (attempt % 6 === 0) { // Log every 30 seconds
          console.log(`  [${attempt * 5}s] Checking for new transactions... (${currentTxs.length} total)`);
        }

        // Find new transactions that weren't in the initial set
        const newTxs = currentTxs.filter(tx => !initialTxHashes.has(tx.hash));

        if (newTxs.length > 0) {
          const latestTx = newTxs[0];
          const isIncoming = latestTx.to?.toLowerCase() === MOONPAY_DEPOSIT_ADDRESS.toLowerCase();
          const amountEth = Number(BigInt(latestTx.value || "0")) / 1e18;

          console.log("");
          console.log("=".repeat(50));
          console.log("NEW TRANSACTION DETECTED ON SEPOLIA!");
          console.log("=".repeat(50));
          console.log(`  Direction: ${isIncoming ? "INCOMING" : "OUTGOING"}`);
          console.log(`  Amount: ${amountEth.toFixed(6)} ETH`);
          console.log(`  From: ${latestTx.from}`);
          console.log(`  To: ${latestTx.to}`);
          console.log(`  Tx: ${latestTx.hash}`);
          console.log(`  (Proceeding to Coinbase offramp with Solana USDC)`);
          console.log("=".repeat(50));
          console.log("");

          // Return the expected USDC amount for Coinbase (ignore actual ETH amount)
          return { txHash: latestTx.hash, amount: expectedAmount };
        }
      } catch (error) {
        console.error(`  Error checking Sepolia transactions (attempt ${attempt}):`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error(`Sepolia transaction timeout after ${maxAttempts * 5} seconds`);
  }

  // Production mode: detect USDC on Solana
  console.log(`Waiting for ${expectedAmount} USDC at ${depositAddress}`);

  const depositPubkey = new PublicKey(depositAddress);

  // Poll for USDC balance
  const maxAttempts = 60; // 5 minutes with 5s intervals
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Get token accounts for this address
      const tokenAccounts =
        await solanaConnection.getParsedTokenAccountsByOwner(depositPubkey, {
          mint: USDC_MINT,
        });

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
  // Hardcode $5 for testing (FIAT_WALLET minimum is $1)
  const offrampAmount = 5;
  console.log(`Generating offramp URL for ${offrampAmount} USDC → ${currency} (requested: ${amount})`);

  const apiPath = "/onramp/v1/sell/quote";
  const token = await generateCDPToken(apiPath, "POST");

  const response = await fetch(`${CDP_API_URL}${apiPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      sellCurrency: "USDC",
      sellAmount: offrampAmount.toString(),
      sellNetwork: "solana",
      cashoutCurrency: currency,
      paymentMethod: "FIAT_WALLET",
      country: "US",
      subdivision: "CA",
      sourceAddress, // Solana address from FURNEL_DEPOSIT_ADDRESS
      redirectUrl: `${process.env.CALLBACK_DOMAIN || "http://localhost"}/api/webhooks/coinbase/callback`,
      partnerUserId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Coinbase quote failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as CoinbaseQuoteResponse;

  console.log(`Coinbase API response:`, JSON.stringify(data, null, 2));
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

// Activity: Send offramp email to recipient
// The recipient must click the Coinbase link to receive funds
// For now, this is mocked - just logs the link and returns success
export async function sendOfframpEmail(
  recipientEmail: string,
  recipientName: string,
  offrampUrl: string,
  amount: number,
  currency: string,
  paymentId: string
): Promise<{ sent: boolean; offrampUrl: string }> {
  // Always log the link prominently so it's easy to find
  console.log("");
  console.log("=".repeat(60));
  console.log("OFFRAMP LINK FOR RECIPIENT");
  console.log("=".repeat(60));
  console.log(`  Recipient: ${recipientName} <${recipientEmail}>`);
  console.log(`  Amount: $${amount} USD → ${currency}`);
  console.log(`  Payment ID: ${paymentId}`);
  console.log("");
  console.log(`  LINK: ${offrampUrl}`);
  console.log("");
  console.log("  (Share this link with the recipient to complete the transfer)");
  console.log("=".repeat(60));
  console.log("");

  // Store offramp URL in database so frontend can retrieve it
  await pool.query(
    `UPDATE payments SET offramp_url = $2, updated_at = NOW() WHERE id = $1`,
    [paymentId, offrampUrl]
  );

  return { sent: true, offrampUrl };
}
