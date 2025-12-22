import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  executeChild,
  ParentClosePolicy,
  ApplicationFailure,
} from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

// ============================================================
// Activity Proxies
// ============================================================

const {
  lockFXRate,
  generateOfframpURL,
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

// ============================================================
// Signal Definitions
// ============================================================

// Signal: USDC received notification (from MoonPay webhook)
export const usdcReceivedSignal = defineSignal<[{ txHash: string; amount: number }]>(
  "usdcReceived"
);

// Signal: Offramp completed notification (from Coinbase webhook)
export const offrampCompletedSignal = defineSignal<[{ orderId: string; status: string }]>(
  "offrampCompleted"
);

// Signal: Cancel the payment (user requested)
export const cancelPaymentSignal = defineSignal<[{ reason: string }]>("cancelPayment");

// ============================================================
// Query Definitions
// ============================================================

// Query: Get current payment state
export const getPaymentStateQuery = defineQuery<PaymentState>("getPaymentState");

// Query: Get compensation history
export const getCompensationHistoryQuery = defineQuery<CompensationStep[]>(
  "getCompensationHistory"
);

// ============================================================
// Type Definitions
// ============================================================

export interface PaymentInput {
  paymentId: string;
  amount: number;
  currency: string;
  depositAddress: string;
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
  usdcReceived: boolean;
  usdcTxHash?: string;
  usdcAmount?: number;
  fxRate?: number;
  fxRateExpiresAt?: Date;
  offrampUrl?: string;
  quoteId?: string;
  offrampOrderId?: string;
  deliveryConfirmed: boolean;
  cancelled: boolean;
  cancelReason?: string;
  error?: string;
}

// Saga compensation tracking
export interface CompensationStep {
  action: "USDC_RECEIVED" | "FX_LOCKED" | "OFFRAMP_INITIATED";
  timestamp: Date;
  data: Record<string, unknown>;
  compensated: boolean;
}

// Child workflow inputs
export interface OnrampInput {
  paymentId: string;
  depositAddress: string;
  expectedAmount: number;
}

export interface OnrampResult {
  success: boolean;
  txHash?: string;
  amount?: number;
  error?: string;
}

export interface OfframpInput {
  paymentId: string;
  amount: number;
  currency: string;
  sourceAddress: string;
  redirectUrl: string;
  recipientBankDetails: {
    name: string;
    accountNumber: string;
    sortCode?: string;
    iban?: string;
  };
}

export interface OfframpResult {
  success: boolean;
  quoteId?: string;
  offrampUrl?: string;
  orderId?: string;
  error?: string;
}

// ============================================================
// Child Workflow: Onramp (Wait for USDC deposit)
// ============================================================

export async function onrampWorkflow(input: OnrampInput): Promise<OnrampResult> {
  try {
    const deposit = await longRunningActivities.waitForUSDC(
      input.depositAddress,
      input.expectedAmount
    );
    return {
      success: true,
      txHash: deposit.txHash,
      amount: deposit.amount,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

// ============================================================
// Child Workflow: Offramp (Coinbase redirect flow)
// ============================================================

export async function offrampWorkflow(input: OfframpInput): Promise<OfframpResult> {
  // State for signal handling
  let offrampCompleted = false;
  let offrampStatus = "";
  let offrampOrderId = "";

  // Register signal handler for offramp completion
  setHandler(offrampCompletedSignal, (data) => {
    offrampCompleted = true;
    offrampStatus = data.status;
    offrampOrderId = data.orderId;
  });

  try {
    // Generate Coinbase offramp URL
    const offramp = await generateOfframpURL(
      input.amount,
      input.currency,
      input.sourceAddress,
      input.paymentId,
      input.redirectUrl
    );

    // Wait for user to complete on Coinbase (via signal or polling)
    const completed = await condition(
      () => offrampCompleted,
      "24 hours" // Max wait time
    );

    if (completed && offrampStatus === "completed") {
      return {
        success: true,
        quoteId: offramp.quoteId,
        offrampUrl: offramp.offrampUrl,
        orderId: offrampOrderId,
      };
    }

    // Fallback: poll database for completion
    const delivered = await longRunningActivities.confirmDelivery(offramp.quoteId);
    return {
      success: delivered,
      quoteId: offramp.quoteId,
      offrampUrl: offramp.offrampUrl,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

// ============================================================
// Main Payment Workflow (Orchestrator with Saga Pattern)
// ============================================================

export async function paymentWorkflow(input: PaymentInput): Promise<PaymentState> {
  // Initialize state
  const state: PaymentState = {
    status: "INITIATED",
    usdcReceived: false,
    deliveryConfirmed: false,
    cancelled: false,
  };

  // Track compensation steps for saga rollback
  const compensationHistory: CompensationStep[] = [];

  // Signal state for cancellation
  let cancelRequested = false;
  let cancelReason = "";

  // ============================================================
  // Register Signal Handlers
  // ============================================================

  // Note: usdcReceivedSignal can be used for faster webhook-driven detection
  // Currently the child workflow polls, but signals provide an alternative path
  setHandler(usdcReceivedSignal, (data) => {
    // Update state immediately when signal received
    state.usdcTxHash = data.txHash;
    state.usdcAmount = data.amount;
  });

  setHandler(cancelPaymentSignal, (data) => {
    cancelRequested = true;
    cancelReason = data.reason;
  });

  // ============================================================
  // Register Query Handlers
  // ============================================================

  setHandler(getPaymentStateQuery, () => state);
  setHandler(getCompensationHistoryQuery, () => compensationHistory);

  // ============================================================
  // Saga Compensation Function
  // ============================================================

  async function compensate(upToStep: number): Promise<void> {
    state.status = "COMPENSATING";
    await updatePaymentStatus(input.paymentId, state.status);

    // Compensate in reverse order
    for (let i = upToStep - 1; i >= 0; i--) {
      const step = compensationHistory[i];
      if (step.compensated) continue;

      switch (step.action) {
        case "USDC_RECEIVED":
          // Refund USDC if we have a user wallet (currently goes to manual queue)
          // In production, would transfer USDC back to user
          await refundUSDC(input.amount, input.depositAddress);
          step.compensated = true;
          break;

        case "FX_LOCKED":
          // FX rate lock doesn't need compensation (it just expires)
          step.compensated = true;
          break;

        case "OFFRAMP_INITIATED":
          // Can't cancel Coinbase redirect once generated
          // Would need to contact support or wait for expiry
          step.compensated = true;
          break;
      }
    }

    state.status = "REFUNDED";
    await updatePaymentStatus(input.paymentId, state.status);
  }

  // ============================================================
  // Main Payment Flow
  // ============================================================

  try {
    // ----- Step 1: Wait for USDC deposit -----
    await updatePaymentStatus(input.paymentId, "WAITING_FOR_USDC");
    state.status = "WAITING_FOR_USDC";

    // Wait for either: signal from webhook, polling detection, or cancellation
    const onrampResult = await executeChild(onrampWorkflow, {
      workflowId: `${input.paymentId}-onramp`,
      args: [{
        paymentId: input.paymentId,
        depositAddress: input.depositAddress,
        expectedAmount: input.amount,
      }],
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    });

    // Check for cancellation
    if (cancelRequested) {
      state.cancelled = true;
      state.cancelReason = cancelReason;
      state.status = "CANCELLED";
      await updatePaymentStatus(input.paymentId, state.status);
      return state;
    }

    if (!onrampResult.success) {
      throw ApplicationFailure.nonRetryable(
        onrampResult.error || "USDC deposit failed"
      );
    }

    // Record compensation step
    compensationHistory.push({
      action: "USDC_RECEIVED",
      timestamp: new Date(),
      data: { txHash: onrampResult.txHash, amount: onrampResult.amount },
      compensated: false,
    });

    state.usdcReceived = true;
    state.usdcTxHash = onrampResult.txHash;
    state.usdcAmount = onrampResult.amount;
    state.status = "USDC_RECEIVED";
    await updatePaymentStatus(input.paymentId, state.status);

    // ----- Step 2: Lock FX Rate -----
    if (cancelRequested) {
      await compensate(compensationHistory.length);
      state.cancelled = true;
      state.cancelReason = cancelReason;
      return state;
    }

    await updatePaymentStatus(input.paymentId, "LOCKING_FX");
    state.status = "LOCKING_FX";

    const fx = await lockFXRate(input.currency);

    compensationHistory.push({
      action: "FX_LOCKED",
      timestamp: new Date(),
      data: { rate: fx.rate, expiresAt: fx.expiresAt },
      compensated: false,
    });

    state.fxRate = fx.rate;
    state.fxRateExpiresAt = fx.expiresAt;
    state.status = "FX_LOCKED";
    await updatePaymentStatus(input.paymentId, state.status);

    // ----- Step 3: Generate Offramp URL -----
    if (cancelRequested) {
      await compensate(compensationHistory.length);
      state.cancelled = true;
      state.cancelReason = cancelReason;
      return state;
    }

    await updatePaymentStatus(input.paymentId, "GENERATING_OFFRAMP_URL");
    state.status = "GENERATING_OFFRAMP_URL";

    const offramp = await generateOfframpURL(
      input.amount,
      input.currency,
      input.depositAddress,
      input.paymentId,
      input.redirectUrl
    );

    compensationHistory.push({
      action: "OFFRAMP_INITIATED",
      timestamp: new Date(),
      data: { quoteId: offramp.quoteId, offrampUrl: offramp.offrampUrl },
      compensated: false,
    });

    state.offrampUrl = offramp.offrampUrl;
    state.quoteId = offramp.quoteId;
    state.status = "AWAITING_USER_ACTION";
    await updatePaymentStatus(input.paymentId, state.status);

    // ----- Step 4: Wait for Offramp Completion -----
    await updatePaymentStatus(input.paymentId, "WAITING_FOR_OFFRAMP");
    state.status = "WAITING_FOR_OFFRAMP";

    const delivered = await longRunningActivities.confirmDelivery(offramp.quoteId);

    if (cancelRequested && !delivered) {
      await compensate(compensationHistory.length);
      state.cancelled = true;
      state.cancelReason = cancelReason;
      return state;
    }

    if (delivered) {
      state.deliveryConfirmed = true;
      state.status = "COMPLETED";
      await updatePaymentStatus(input.paymentId, state.status);
    } else {
      throw ApplicationFailure.nonRetryable("Delivery confirmation failed");
    }

    return state;

  } catch (error) {
    // ----- Compensation on Failure -----
    state.error = String(error);

    if (compensationHistory.length > 0) {
      await compensate(compensationHistory.length);
    } else {
      state.status = "FAILED";
      await updatePaymentStatus(input.paymentId, state.status);
    }

    return state;
  }
}
