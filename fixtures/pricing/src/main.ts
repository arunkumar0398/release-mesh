import { createPricingServer } from "./server.js";
import { parsePricingMode } from "./pricing-mode.js";

const port = Number.parseInt(process.env.PORT ?? "4100", 10);
const server = createPricingServer({ mode: parsePricingMode(process.env.PRICING_MODE) });

server.listen(port, "0.0.0.0", () => {
  console.log(`Pricing fixture listening on ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
