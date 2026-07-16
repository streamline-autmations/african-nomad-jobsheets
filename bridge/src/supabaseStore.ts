import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BridgeConfig } from "./config";
import type { QueueRow, QueueStore } from "./types";

/**
 * QueueStore backed by Supabase, using the SERVICE ROLE key. The service role
 * bypasses RLS, which is required: qbd_sync_queue is read-only for the anon
 * role (writes to it are the whole security boundary of the system), and the
 * bridge is the trusted server-side component allowed to record sync results.
 */
export class SupabaseQueueStore implements QueueStore {
  private client: SupabaseClient;

  constructor(config: BridgeConfig) {
    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async fetchPendingRows(): Promise<QueueRow[]> {
    const { data, error } = await this.client
      .from("qbd_sync_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as QueueRow[];
  }

  async requeueStaleSent(olderThanMinutes: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
    // Reset rows left in 'sent' by an interrupted session. `or` covers rows
    // marked sent before sent_at existed (null) as well as genuinely stale ones.
    const { error } = await this.client
      .from("qbd_sync_queue")
      .update({ status: "pending", sent_at: null })
      .eq("status", "sent")
      .or(`sent_at.is.null,sent_at.lt.${cutoff}`);
    if (error) throw error;
  }

  async markSent(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.client
      .from("qbd_sync_queue")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in("id", ids);
    if (error) throw error;
  }

  async markConfirmed(id: string, qbdId: string): Promise<void> {
    const { error } = await this.client
      .from("qbd_sync_queue")
      .update({
        status: "confirmed",
        qbd_txn_id: qbdId,
        error_message: null,
        synced_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.client
      .from("qbd_sync_queue")
      .update({ status: "failed", error_message: errorMessage.slice(0, 2000) })
      .eq("id", id);
    if (error) throw error;
  }

  async jobSheetQueued(jobSheetId: string): Promise<void> {
    // Only advance a still-approved sheet to 'queued'; never drag a sheet that
    // already reached 'synced' backwards.
    const { error } = await this.client
      .from("job_sheets")
      .update({ status: "queued" })
      .eq("id", jobSheetId)
      .eq("status", "approved");
    if (error) throw error;
  }

  async jobSheetSynced(jobSheetId: string, estimateTxnId: string): Promise<void> {
    const { error } = await this.client
      .from("job_sheets")
      .update({
        status: "synced",
        qbd_estimate_txn_id: estimateTxnId,
        synced_at: new Date().toISOString(),
      })
      .eq("id", jobSheetId);
    if (error) throw error;
  }

  async jobSheetInvoiceSynced(jobSheetId: string, invoiceTxnId: string): Promise<void> {
    const { error } = await this.client
      .from("job_sheets")
      .update({ qbd_invoice_txn_id: invoiceTxnId })
      .eq("id", jobSheetId);
    if (error) throw error;
  }

  async jobSheetFailed(jobSheetId: string): Promise<void> {
    const { error } = await this.client
      .from("job_sheets")
      .update({ status: "failed" })
      .eq("id", jobSheetId);
    if (error) throw error;
  }

  async upsertCustomerMirror(name: string, qbdListId: string): Promise<string> {
    const { data, error } = await this.client
      .from("customers")
      .upsert(
        { name, qbd_list_id: qbdListId, last_synced_at: new Date().toISOString() },
        { onConflict: "qbd_list_id" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async setJobSheetCustomer(jobSheetId: string, customerId: string): Promise<void> {
    const { error } = await this.client
      .from("job_sheets")
      .update({ customer_id: customerId })
      .eq("id", jobSheetId);
    if (error) throw error;
  }
}
