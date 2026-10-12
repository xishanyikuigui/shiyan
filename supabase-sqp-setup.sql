-- Run once in the Supabase SQL Editor for the shiyan app project.
create table if not exists public.sqp_reports (
  id uuid primary key,
  asin text not null,
  marketplace text not null,
  period text not null default '',
  file_name text not null,
  row_count integer not null default 0,
  rows jsonb not null,
  storage_path text not null,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists sqp_reports_asin_marketplace_created_idx
  on public.sqp_reports (asin, marketplace, created_at desc);

alter table public.sqp_reports enable row level security;
drop policy if exists "Authenticated users can read SQP reports" on public.sqp_reports;
create policy "Authenticated users can read SQP reports" on public.sqp_reports
  for select to authenticated using (true);
drop policy if exists "Authenticated users can upload SQP reports" on public.sqp_reports;
create policy "Authenticated users can upload SQP reports" on public.sqp_reports
  for insert to authenticated with check (uploaded_by = auth.uid());
drop policy if exists "Uploaders can delete their SQP reports" on public.sqp_reports;
create policy "Uploaders can delete their SQP reports" on public.sqp_reports
  for delete to authenticated using (uploaded_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit)
values ('sqp-reports', 'sqp-reports', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "Authenticated users can read SQP source files" on storage.objects;
create policy "Authenticated users can read SQP source files" on storage.objects
  for select to authenticated using (bucket_id = 'sqp-reports');
drop policy if exists "Authenticated users can upload SQP source files" on storage.objects;
create policy "Authenticated users can upload SQP source files" on storage.objects
  for insert to authenticated with check (bucket_id = 'sqp-reports' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Uploaders can delete SQP source files" on storage.objects;
create policy "Uploaders can delete SQP source files" on storage.objects
  for delete to authenticated using (bucket_id = 'sqp-reports' and (storage.foldername(name))[1] = auth.uid()::text);
