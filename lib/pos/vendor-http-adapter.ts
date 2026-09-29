import "server-only";

export type VendorSummary = {
  memberCount: number;
  usablePoints: number;
  accumulatedPoints: number;
  usedPoints: number;
};

export type VendorCustomer = {
  name: string;
  usablePoints: number;
  accumulatedPoints: number;
  usedPoints: number;
};

async function vendorFetch(baseUrl: string, apiKey: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`VENDOR_API_ERROR_${res.status}`);
  return res.json();
}

export async function fetchVendorSummary(baseUrl: string, apiKey: string): Promise<VendorSummary> {
  const data = await vendorFetch(baseUrl, apiKey, "/api/summary");
  return data as VendorSummary;
}

export async function fetchVendorCustomer(
  baseUrl: string,
  apiKey: string,
  phone: string
): Promise<VendorCustomer | null> {
  const data = await vendorFetch(baseUrl, apiKey, `/api/customers/${encodeURIComponent(phone)}`);
  return data as VendorCustomer | null;
}
