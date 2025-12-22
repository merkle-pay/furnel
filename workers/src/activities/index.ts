// Furnel Activities
// USDC → Local Currency Offramp

export async function waitForUSDC(
  depositAddress: string,
  expectedAmount: number
): Promise<{ txHash: string; amount: number }> {
  console.log(`Waiting for ${expectedAmount} USDC at ${depositAddress}`);
  // TODO: Poll Solana for USDC deposit
  // Use @solana/web3.js to check token account balance
  await simulateApiCall(2000);
  const txHash = `sol_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  console.log(`USDC received: ${txHash}`);
  return { txHash, amount: expectedAmount };
}

export async function lockFXRate(
  targetCurrency: string
): Promise<{ rate: number; expiresAt: Date }> {
  console.log(`Locking FX rate for USDC → ${targetCurrency}`);
  // TODO: Get real FX rate from offramp partner (Coinbase/Transak)
  await simulateApiCall(500);

  // Mock FX rates
  const rates: Record<string, number> = {
    GBP: 0.79,
    EUR: 0.92,
    PHP: 56.5,
    NGN: 1550,
    BRL: 4.95,
  };

  const rate = rates[targetCurrency] || 1;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry
  console.log(`FX rate locked: 1 USDC = ${rate} ${targetCurrency}`);
  return { rate, expiresAt };
}

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
  console.log(`Executing offramp: ${amount} ${currency} to ${recipientBankDetails.name}`);
  // TODO: Integrate with Coinbase Offramp / Transak API
  // 1. Create offramp order with recipient bank details
  // 2. Get deposit address for USDC
  // 3. Send USDC to their address
  // 4. Return order ID for tracking
  await simulateApiCall(3000);
  const orderId = `offramp_${Date.now()}`;
  const estimatedArrival = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  console.log(`Offramp order created: ${orderId}`);
  return { orderId, estimatedArrival };
}

export async function confirmDelivery(orderId: string): Promise<boolean> {
  console.log(`Confirming delivery for order ${orderId}`);
  // TODO: Poll offramp partner API for delivery confirmation
  await simulateApiCall(1000);
  console.log(`Delivery confirmed`);
  return true;
}

// Compensation activities
export async function refundUSDC(
  amount: number,
  userWalletAddress: string
): Promise<string> {
  console.log(`Refunding ${amount} USDC to ${userWalletAddress}`);
  // TODO: Send USDC back to user's Solana wallet
  await simulateApiCall(1000);
  const txHash = `refund_${Date.now()}`;
  console.log(`Refund complete: ${txHash}`);
  return txHash;
}

// Status updates
export async function updatePaymentStatus(
  paymentId: string,
  status: string
): Promise<void> {
  console.log(`Payment ${paymentId} → ${status}`);
  // TODO: Update database
}

// Helper
async function simulateApiCall(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
