import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MoonPayBuyWidget } from "@moonpay/moonpay-react";
import { DollarSign, Building2, User, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({ component: PaymentPage });

function PaymentPage() {
  const [step, setStep] = useState<"form" | "buy" | "confirm">("form");
  const [showMoonPay, setShowMoonPay] = useState(false);
  const [formData, setFormData] = useState({
    amount: "",
    recipientName: "",
    accountNumber: "",
    sortCode: "",
    currency: "GBP",
  });
  const [paymentResult, setPaymentResult] = useState<{
    paymentId: string;
    depositAddress: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Create payment on backend
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number.parseFloat(formData.amount),
          currency: formData.currency,
          recipientName: formData.recipientName,
          recipientAccountNumber: formData.accountNumber,
          recipientSortCode: formData.sortCode,
        }),
      });

      const data = await response.json();
      setPaymentResult(data);
      setStep("buy");
    } catch (error) {
      console.error("Failed to create payment:", error);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <section className="relative py-12 px-6 text-center">
        <div className="relative max-w-3xl mx-auto">
          <h1 className="text-5xl font-black text-white mb-4">
            <span className="bg-linear-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              Furnel
            </span>
          </h1>
          <p className="text-xl text-gray-300">
            USDC → Local Currency in minutes
          </p>
        </div>
      </section>

      {/* Steps indicator */}
      <div className="max-w-2xl mx-auto px-6 mb-8">
        <div className="flex items-center justify-center gap-4">
          <StepIndicator
            number={1}
            label="Details"
            active={step === "form"}
            completed={step !== "form"}
          />
          <div className="w-12 h-0.5 bg-slate-700" />
          <StepIndicator
            number={2}
            label="Buy USDC"
            active={step === "buy"}
            completed={step === "confirm"}
          />
          <div className="w-12 h-0.5 bg-slate-700" />
          <StepIndicator number={3} label="Complete" active={step === "confirm"} />
        </div>
      </div>

      {/* Main content */}
      <section className="max-w-2xl mx-auto px-6 pb-20">
        {step === "form" && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Amount */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
              <label className="block text-gray-300 text-sm font-medium mb-2">
                <DollarSign className="inline w-4 h-4 mr-1" />
                Amount (USD)
              </label>
              <input
                type="number"
                value={formData.amount}
                onChange={(e) =>
                  setFormData({ ...formData, amount: e.target.value })
                }
                placeholder="100.00"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-2xl font-semibold focus:border-cyan-500 focus:outline-none"
                required
              />
              <p className="text-gray-500 text-sm mt-2">
                You'll buy this amount in USDC, then offramp to{" "}
                {formData.currency}
              </p>
            </div>

            {/* Recipient Details */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6 space-y-4">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Building2 className="w-5 h-5 text-cyan-400" />
                Recipient Bank Details
              </h3>

              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">
                  <User className="inline w-4 h-4 mr-1" />
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={formData.recipientName}
                  onChange={(e) =>
                    setFormData({ ...formData, recipientName: e.target.value })
                  }
                  placeholder="John Doe"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Account Number
                  </label>
                  <input
                    type="text"
                    value={formData.accountNumber}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        accountNumber: e.target.value,
                      })
                    }
                    placeholder="12345678"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Sort Code
                  </label>
                  <input
                    type="text"
                    value={formData.sortCode}
                    onChange={(e) =>
                      setFormData({ ...formData, sortCode: e.target.value })
                    }
                    placeholder="12-34-56"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">
                  Currency
                </label>
                <select
                  value={formData.currency}
                  onChange={(e) =>
                    setFormData({ ...formData, currency: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="GBP">GBP (British Pound)</option>
                  <option value="EUR">EUR (Euro)</option>
                  <option value="USD">USD (US Dollar)</option>
                </select>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="w-full py-4 bg-linear-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2"
            >
              Continue to Buy USDC
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>
        )}

        {step === "buy" && paymentResult && (
          <div className="space-y-6">
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-4">Payment Created</h3>
              <div className="space-y-2 text-sm">
                <p className="text-gray-400">
                  Payment ID:{" "}
                  <span className="text-cyan-400 font-mono">
                    {paymentResult.paymentId}
                  </span>
                </p>
                <p className="text-gray-400">
                  Amount:{" "}
                  <span className="text-white font-semibold">
                    ${formData.amount} USD
                  </span>
                </p>
                <p className="text-gray-400">
                  Recipient:{" "}
                  <span className="text-white">{formData.recipientName}</span>
                </p>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm border border-cyan-500/50 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-2">
                Step 1: Buy USDC with MoonPay
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                Click below to purchase USDC. It will be sent to your Solana
                wallet.
              </p>
              <button
                type="button"
                onClick={() => setShowMoonPay(true)}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors"
              >
                Buy USDC with Card
              </button>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-2">
                Deposit Address
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                MoonPay will send USDC directly to this address:
              </p>
              <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-cyan-400 break-all">
                {paymentResult.depositAddress}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="w-full py-4 bg-linear-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all"
            >
              I've Completed the Purchase
            </button>
          </div>
        )}

        {step === "confirm" && (
          <div className="bg-slate-800/50 backdrop-blur-sm border border-green-500/50 rounded-xl p-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">
              Payment Processing
            </h3>
            <p className="text-gray-400 mb-4">
              We're detecting your USDC deposit. Once confirmed, we'll convert
              it to {formData.currency} and send to {formData.recipientName}.
            </p>
            <p className="text-cyan-400 text-sm">
              Payment ID: {paymentResult?.paymentId}
            </p>
          </div>
        )}
      </section>

      {/* MoonPay Widget - sends USDC directly to Furnel deposit address */}
      <MoonPayBuyWidget
        variant="overlay"
        baseCurrencyCode="usd"
        baseCurrencyAmount={formData.amount || "100"}
        defaultCurrencyCode="usdc_sol"
        walletAddress={paymentResult?.depositAddress || ""}
        visible={showMoonPay}
        onClose={() => setShowMoonPay(false)}
      />
    </div>
  );
}

function StepIndicator({
  number,
  label,
  active,
  completed,
}: {
  number: number;
  label: string;
  active?: boolean;
  completed?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
          active
            ? "bg-cyan-500 text-white"
            : completed
              ? "bg-green-500 text-white"
              : "bg-slate-700 text-gray-400"
        }`}
      >
        {completed ? "✓" : number}
      </div>
      <span
        className={`text-sm ${active ? "text-cyan-400" : "text-gray-500"}`}
      >
        {label}
      </span>
    </div>
  );
}
