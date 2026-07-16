-- Adds sent_at to qbd_sync_queue so the QBD Bridge can recover rows stranded
-- in 'sent' by a crashed session or QuickBooks being closed mid-sync. The
-- bridge stamps sent_at when it marks a batch 'sent', and on the next
-- authenticate it requeues any 'sent' row whose sent_at is older than a
-- safety threshold back to 'pending'.

alter table public.qbd_sync_queue
  add column if not exists sent_at timestamptz;
