import { createServer, type Server } from "node:http";

import type { PricingMode } from "./pricing-mode.js";

export interface PricingServerOptions {
  mode: PricingMode;
}

const pricingResponses = {
  v1: { currency: "INR", price: 1299 },
  v2: { amount: 1299, currencyCode: "INR" },
  "v2.1": { amount: 1299, currency: "INR", currencyCode: "INR", price: 1299 }
} as const satisfies Record<PricingMode, Readonly<Record<string, number | string>>>;

export function createPricingServer({ mode }: PricingServerOptions): Server {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://pricing.local");
    const isPricingRoute = /^\/pricing\/[^/]+$/.test(requestUrl.pathname);

    if (!isPricingRoute) {
      response.writeHead(404).end();
      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }

    const requestedCandidate = requestUrl.searchParams.get("candidateVersion");
    const responseMode = requestedCandidate === "v2" || requestedCandidate === "v2.1"
      ? requestedCandidate
      : mode;

    response
      .writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json; charset=utf-8"
      })
      .end(JSON.stringify(pricingResponses[responseMode]));
  });
}
