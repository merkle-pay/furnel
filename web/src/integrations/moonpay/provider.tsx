import { MoonPayProvider } from "@moonpay/moonpay-react";
import type { ReactNode } from "react";

// Use test key for development, production key from env
const MOONPAY_API_KEY =
  import.meta.env.VITE_MOONPAY_API_KEY ||
  "pk_test_plX9fVXE26ySgtqV1xyaOj6lFPCcNA";

interface MoonPayProviderWrapperProps {
  children: ReactNode;
}

export function MoonPayProviderWrapper({
  children,
}: MoonPayProviderWrapperProps) {
  return (
    <MoonPayProvider
      apiKey={MOONPAY_API_KEY}
      debug={import.meta.env.DEV}
    >
      {children}
    </MoonPayProvider>
  );
}
