export function parseTrustedOrigins(value: string): string[] {
  return value.split(",").map((entry) => {
    const url = new URL(entry.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Trusted origins must use HTTP or HTTPS");
    }
    if (url.username || url.password) throw new Error("Trusted origins must not include credentials");
    if (url.pathname !== "/" || url.search || url.hash) throw new Error("Trusted origins must be origins");
    return url.origin;
  });
}
