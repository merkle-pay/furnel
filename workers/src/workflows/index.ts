import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const {
  waitForUSDC,
  lockFXRate,
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

export interface PaymentInput {
  paymentId: string;
  amount: number;
  currency: string;
  depositAddress: string;
  userWalletAddress: string;
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
  offrampOrderId?: string;
  deliveryConfirmed?: boolean;
  error?: string;
}

export async function paymentWorkflow(input: PaymentInput): Promise<PaymentState> {
  const state: PaymentState = { status: "INITIATED" };

  try {
    // Step 1: Wait for USDC deposit
    await updatePaymentStatus(input.paymentId, "WAITING_FOR_USDC");
    const deposit = await waitForUSDC(input.depositAddress, input.amount);
    state.usdcReceived = true;
    state.status = "USDC_RECEIVED";
    await updatePaymentStatus(input.paymentId, state.status);

    // Step 2: Lock FX Rate
    await updatePaymentStatus(input.paymentId, "LOCKING_FX");
    const fx = await lockFXRate(input.currency);
    state.fxRate = fx.rate;
    state.status = "FX_LOCKED";
    await updatePaymentStatus(input.paymentId, state.status);

    // Step 3: Execute Offramp
    await updatePaymentStatus(input.paymentId, "OFFRAMPING");
    const localAmount = input.amount * fx.rate;
    const offramp = await executeOfframp(
      localAmount,
      input.currency,
      input.recipientBankDetails
    );
    state.offrampOrderId = offramp.orderId;
    state.status = "LOCAL_SENT";
    await updatePaymentStatus(input.paymentId, state.status);

    // Step 4: Confirm Delivery
    await updatePaymentStatus(input.paymentId, "CONFIRMING");
    await confirmDelivery(offramp.orderId);
    state.deliveryConfirmed = true;
    state.status = "COMPLETED";
    await updatePaymentStatus(input.paymentId, state.status);

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
