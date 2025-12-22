import { proxyActivities, sleep } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const {
  collectUSD,
  mintUSDC,
  lockFXRate,
  executeOfframp,
  confirmDelivery,
  refundUSDC,
  returnUSD,
  updatePaymentStatus,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "1s",
    maximumInterval: "30s",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface PaymentInput {
  amount: number;
  currency: string;
  recipientId: string;
}

export interface PaymentState {
  status: string;
  usdCollected?: boolean;
  usdcMinted?: boolean;
  fxRateLocked?: boolean;
  offrampExecuted?: boolean;
  deliveryConfirmed?: boolean;
  error?: string;
}

export async function paymentWorkflow(input: PaymentInput): Promise<PaymentState> {
  const state: PaymentState = { status: "INITIATED" };

  try {
    // Step 1: Collect USD
    await updatePaymentStatus(input.recipientId, "USD_COLLECTING");
    await collectUSD(input.amount, input.recipientId);
    state.usdCollected = true;
    state.status = "USD_COLLECTED";
    await updatePaymentStatus(input.recipientId, state.status);

    // Step 2: Mint USDC
    await updatePaymentStatus(input.recipientId, "USDC_MINTING");
    await mintUSDC(input.amount);
    state.usdcMinted = true;
    state.status = "USDC_MINTED";
    await updatePaymentStatus(input.recipientId, state.status);

    // Step 3: Lock FX Rate
    await updatePaymentStatus(input.recipientId, "FX_LOCKING");
    const fxRate = await lockFXRate(input.currency);
    state.fxRateLocked = true;
    state.status = "FX_LOCKED";
    await updatePaymentStatus(input.recipientId, state.status);

    // Step 4: Execute Offramp
    await updatePaymentStatus(input.recipientId, "OFFRAMPING");
    const localAmount = input.amount * fxRate;
    await executeOfframp(localAmount, input.currency, input.recipientId);
    state.offrampExecuted = true;
    state.status = "LOCAL_SENT";
    await updatePaymentStatus(input.recipientId, state.status);

    // Step 5: Confirm Delivery
    await updatePaymentStatus(input.recipientId, "CONFIRMING");
    await confirmDelivery(input.recipientId);
    state.deliveryConfirmed = true;
    state.status = "COMPLETED";
    await updatePaymentStatus(input.recipientId, state.status);

    return state;
  } catch (error) {
    // Compensation: Saga rollback
    state.status = "COMPENSATING";
    state.error = String(error);
    await updatePaymentStatus(input.recipientId, state.status);

    try {
      if (state.usdcMinted) {
        await refundUSDC(input.amount);
      }
      if (state.usdCollected) {
        await returnUSD(input.amount, input.recipientId);
      }
      state.status = "REFUNDED";
    } catch (compensationError) {
      state.status = "COMPENSATION_FAILED";
      state.error = `Original: ${error}, Compensation: ${compensationError}`;
    }

    await updatePaymentStatus(input.recipientId, state.status);
    return state;
  }
}
