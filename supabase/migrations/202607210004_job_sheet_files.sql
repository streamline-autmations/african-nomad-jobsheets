-- File attachments for job sheets (generated quote/invoice PDFs, scanned
-- supplier invoices, delivery notes, etc). QuickBooks Desktop's own
-- "Attached Documents" feature is not exposed through qbXML/Web Connector at
-- all, so there is no way to push files into QBD itself — this keeps them
-- attached to the job sheet inside this app instead, which is the only
-- practical option and is arguably more useful anyway (accessible without
-- opening QuickBooks).
create table if not exists public.job_sheet_files (
  id uuid primary key default gen_random_uuid(),
  job_sheet_id uuid not null references public.job_sheets(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  content_type text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

create index if not exists job_sheet_files_job_sheet_id_idx on public.job_sheet_files(job_sheet_id);

alter table public.job_sheet_files enable row level security;

do $$ begin
  create policy "anon can read job sheet files" on public.job_sheet_files
    for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can insert job sheet files" on public.job_sheet_files
    for insert to anon with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can delete job sheet files" on public.job_sheet_files
    for delete to anon using (true);
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public)
values ('job-sheet-files', 'job-sheet-files', false)
on conflict (id) do nothing;

do $$ begin
  create policy "anon can read job sheet files bucket" on storage.objects
    for select to anon using (bucket_id = 'job-sheet-files');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can upload to job sheet files bucket" on storage.objects
    for insert to anon with check (bucket_id = 'job-sheet-files');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can delete from job sheet files bucket" on storage.objects
    for delete to anon using (bucket_id = 'job-sheet-files');
exception when duplicate_object then null;
end $$;
