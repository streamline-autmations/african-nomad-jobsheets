import { supabase, supabaseConfigured } from "./supabase";

// Real customers/sub-customers mirrored from NSA's QuickBooks Online company
// (see api/qbo/sync-nsa-customers.ts). Separate from Component 1's
// `customers` table (that one mirrors QBD for the AN internal pipeline) —
// this mirrors NSA's own QBO company for the client-facing quote/invoice
// picker.

function requireSupabase() {
  if (!supabase || !supabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}

export interface NsaQboCustomer {
  id: string;
  qboCustomerId: string;
  displayName: string;
  parentQboCustomerId: string | null;
  isSubCustomer: boolean;
  billAddress: string;
  shipAddress: string;
  vendorNumber: string;
  lastSyncedAt: string | null;
}

type NsaQboCustomerRow = {
  id: string;
  qbo_customer_id: string;
  display_name: string;
  parent_qbo_customer_id: string | null;
  is_sub_customer: boolean;
  bill_address: string;
  ship_address: string;
  vendor_number: string;
  last_synced_at: string | null;
};

function toNsaQboCustomer(row: NsaQboCustomerRow): NsaQboCustomer {
  return {
    id: row.id,
    qboCustomerId: row.qbo_customer_id,
    displayName: row.display_name,
    parentQboCustomerId: row.parent_qbo_customer_id,
    isSubCustomer: row.is_sub_customer,
    billAddress: row.bill_address,
    shipAddress: row.ship_address,
    vendorNumber: row.vendor_number,
    lastSyncedAt: row.last_synced_at,
  };
}

/**
 * Full picker label, e.g. "Sibanye Rustenburg Mine Pty Ltd - Saffy Shaft" for
 * a sub-customer, matching how the real NSA documents print Bill to/Ship to.
 */
export function nsaQboCustomerLabel(
  customer: NsaQboCustomer,
  all: NsaQboCustomer[],
): string {
  if (!customer.parentQboCustomerId) return customer.displayName;
  const parent = all.find((c) => c.qboCustomerId === customer.parentQboCustomerId);
  return parent ? `${parent.displayName} - ${customer.displayName}` : customer.displayName;
}

export async function fetchNsaQboCustomers(): Promise<NsaQboCustomer[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_qbo_customers")
    .select("*")
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toNsaQboCustomer);
}

export async function updateNsaQboCustomerVendorNumber(
  id: string,
  vendorNumber: string,
): Promise<NsaQboCustomer> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_qbo_customers")
    .update({ vendor_number: vendorNumber })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toNsaQboCustomer(data);
}

export async function syncNsaQboCustomers(): Promise<number> {
  const res = await fetch("/api/qbo/sync-nsa-customers", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Sync with QuickBooks failed.");
  return body.synced as number;
}
