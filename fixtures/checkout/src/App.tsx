import { useEffect, useState } from "react";

import { fetchPricingQuote, type PricingQuote } from "./api.js";

export interface AppProps {
  pricingBaseUrl?: string;
  productId?: string;
}

type CheckoutState =
  | { status: "loading" }
  | { quote: PricingQuote; status: "ready" }
  | { message: string; status: "error" };

export function App({
  pricingBaseUrl = "http://127.0.0.1:4100",
  productId = "checkout-demo"
}: AppProps): React.JSX.Element {
  const [state, setState] = useState<CheckoutState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    void fetchPricingQuote(pricingBaseUrl, productId).then(
      (quote) => {
        if (active) {
          setState({ quote, status: "ready" });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            message: error instanceof Error ? error.message : "Unknown Pricing failure",
            status: "error"
          });
        }
      }
    );

    return () => {
      active = false;
    };
  }, [pricingBaseUrl, productId]);

  return (
    <main>
      <h1>Checkout</h1>
      {state.status === "loading" ? <p>Loading pricing…</p> : null}
      {state.status === "ready" ? (
        <section aria-label="Checkout pricing">
          <p>Pricing available</p>
          <strong>{`${state.quote.currency} ${state.quote.price}`}</strong>
        </section>
      ) : null}
      {state.status === "error" ? (
        <section role="alert">
          <h2>Checkout unavailable</h2>
          <p>{state.message}</p>
        </section>
      ) : null}
    </main>
  );
}
