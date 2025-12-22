// Payment Activities
// TODO: Replace with real API integrations (Circle, Coinbase, etc.)

export async function collectUSD(amount: number, userId: string): Promise<void> {
  console.log(`Collecting $${amount} USD from user ${userId}`);
  // TODO: Integrate with payment processor (Stripe, ACH, etc.)
  await simulateApiCall(1000);
  console.log(`USD collection complete: $${amount}`);
}

export async function mintUSDC(amount: number): Promise<string> {
  console.log(`Minting ${amount} USDC`);
  // TODO: Integrate with Circle API
  await simulateApiCall(2000);
  const txHash = `usdc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  console.log(`USDC minted: ${txHash}`);
  return txHash;
}

export async function lockFXRate(targetCurrency: string): Promise<number> {
  console.log(`Locking FX rate for USD -> ${targetCurrency}`);
  // TODO: Get real FX rate from offramp partner
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
  console.log(`FX rate locked: 1 USD = ${rate} ${targetCurrency}`);
  return rate;
}

export async function executeOfframp(
  amount: number,
  currency: string,
  recipientId: string
): Promise<string> {
  console.log(`Executing offramp: ${amount} ${currency} to recipient ${recipientId}`);
  // TODO: Integrate with Coinbase Offramp / Transak / etc.
  await simulateApiCall(3000);
  const txId = `offramp_${Date.now()}`;
  console.log(`Offramp complete: ${txId}`);
  return txId;
}

export async function confirmDelivery(recipientId: string): Promise<boolean> {
  console.log(`Confirming delivery to ${recipientId}`);
  // TODO: Check with offramp partner for confirmation
  await simulateApiCall(1000);
  console.log(`Delivery confirmed`);
  return true;
}

// Compensation activities
export async function refundUSDC(amount: number): Promise<void> {
  console.log(`Refunding ${amount} USDC`);
  // TODO: Burn/return USDC
  await simulateApiCall(1000);
  console.log(`USDC refund complete`);
}

export async function returnUSD(amount: number, userId: string): Promise<void> {
  console.log(`Returning $${amount} USD to user ${userId}`);
  // TODO: Refund via payment processor
  await simulateApiCall(1000);
  console.log(`USD return complete`);
}

// Status updates
export async function updatePaymentStatus(
  paymentId: string,
  status: string
): Promise<void> {
  console.log(`Payment ${paymentId} -> ${status}`);
  // TODO: Update database
}

// Helper
async function simulateApiCall(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
