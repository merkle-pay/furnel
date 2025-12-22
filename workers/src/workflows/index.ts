import { proxyActivities, sleep, condition } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const {
  waitForUSDC,
  lockFXRate,
  generateOfframpURL,
  executeOfframp,
  confirmDelivery,
  refundUSDC,
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

// Long-running activities (polling for USDC, waiting for delivery)
const longRunningActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    initialInterval: "5s",
    maximumInterval: "1 minute",
    backoffCoefficient: 2,
    maximumAttempts: 10,
  },
});

export interface PaymentInput {
  paymentId: string;
  amount: number;
  currency: string;
  depositAddress: string;
  userWalletAddress: string;
  redirectUrl: string;
  recipientBankDetails: {
    name: string;
    accountNumber: string;
    sortCode?: string;
    iban?: string;
  };
}

export interface PaymentState {
  status: string;
  usdcReceived?: boolean;
  fxRate?: number;
  offrampUrl?: string;
  quoteId?: string;
  offrampOrderId?: string;
  deliveryConfirmed?: boolean;
  error?: string;
}

export async function paymentWorkflow(input: PaymentInput): Promise<PaymentState> {
  const state: PaymentState = { status: "INITIATED" };

  try {
    // Step 1: Wait for USDC deposit
    await updatePaymentStatus(input.paymentId, "WAITING_FOR_USDC");
    const deposit = await longRunningActivities.waitForUSDC(
      input.depositAddress,
      input.amount
    );
    state.usdcReceived = true;
    state.status = "USDC_RECEIVED";
    await updatePaymentStatus(input.paymentId, state.status);

    // Step 2: Lock FX Rate
    await updatePaymentStatus(input.paymentId, "LOCKING_FX");
    const fx = await lockFXRate(input.currency);
    state.fxRate = fx.rate;
    state.status = "FX_LOCKED";
    await updatePaymentStatus(input.paymentId, state.status);

    // Step 3: Generate Offramp URL (redirect flow)
    await updatePaymentStatus(input.paymentId, "GENERATING_OFFRAMP_URL");
    const offramp = await generateOfframpURL(
      input.amount,
      input.currency,
      input.userWalletAddress,
      input.paymentId, // Use paymentId as partnerUserId
      input.redirectUrl
    );
    state.offrampUrl = offramp.offrampUrl;
    state.quoteId = offramp.quoteId;
    state.status = "AWAITING_USER_ACTION";
    await updatePaymentStatus(input.paymentId, state.status);

    // Step 4: Wait for user to complete offramp on Coinbase
    // This is a long wait - user must click the URL and complete on Coinbase
    // We poll the database for webhook updates
    await updatePaymentStatus(input.paymentId, "WAITING_FOR_OFFRAMP");
    const delivered = await longRunningActivities.confirmDelivery(offramp.quoteId);

    if (delivered) {
      state.deliveryConfirmed = true;
      state.status = "COMPLETED";
      await updatePaymentStatus(input.paymentId, state.status);
    }

    return state;
  } catch (error) {
    // Compensation: Saga rollback
    state.status = "COMPENSATING";
    state.error = String(error);
    await updatePaymentStatus(input.paymentId, state.status);

    try {
      if (state.usdcReceived) {
        await refundUSDC(input.amount, input.userWalletAddress);
      }
      state.status = "REFUNDED";
    } catch (compensationError) {
      state.status = "COMPENSATION_FAILED";
      state.error = `Original: ${error}, Compensation: ${compensationError}`;
    }

    await updatePaymentStatus(input.paymentId, state.status);
    return state;
  }
}

// Query handler to get current state
export function getPaymentState(): PaymentState {
  // This is called via workflow query
  // In a real implementation, we'd return the current state
  return { status: "QUERY_NOT_IMPLEMENTED" };
}
