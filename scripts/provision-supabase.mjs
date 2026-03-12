#!/usr/bin/env node

import fs from "node:fs/promises";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const accessToken = required("SUPABASE_ACCESS_TOKEN");
const projectRef = required("SUPABASE_PROJECT_REF");
const secretKey = required("SUPABASE_SECRET_KEY");

const loginEmail = process.env.APP_LOGIN_EMAIL || "Logantbaird@gmail.com";
const loginPassword = process.env.APP_LOGIN_PASSWORD || "Kilkinny!982";

const projectApi = (path, init = {}) =>
  fetch(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const projectUrl = `https://${projectRef}.supabase.co`;

const serviceApi = (path, init = {}) =>
  fetch(`${projectUrl}${path}`, {
    ...init,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const sql = `
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  model text not null,
  prompt text not null,
  duration_seconds integer,
  input_media_path text,
  runpod_job_id text not null unique,
  status text not null,
  progress_percent numeric,
  delay_time_ms integer,
  execution_time_ms integer,
  error_reason text,
  runpod_raw jsonb,
  output_media_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  kind text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  prompt text not null,
  model text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.job_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  status text not null,
  message text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_generation_jobs_user_created on public.generation_jobs(user_id, created_at desc);
create index if not exists idx_generation_jobs_runpod_job_id on public.generation_jobs(runpod_job_id);
create index if not exists idx_media_assets_user_created on public.media_assets(user_id, created_at desc);
create index if not exists idx_job_events_job_created on public.job_events(job_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_generation_jobs_set_updated_at on public.generation_jobs;
create trigger trg_generation_jobs_set_updated_at
before update on public.generation_jobs
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.media_assets enable row level security;
alter table public.job_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "jobs_select_own" on public.generation_jobs;
drop policy if exists "jobs_insert_own" on public.generation_jobs;
drop policy if exists "jobs_update_own" on public.generation_jobs;
create policy "jobs_select_own" on public.generation_jobs for select using (auth.uid() = user_id);
create policy "jobs_insert_own" on public.generation_jobs for insert with check (auth.uid() = user_id);
create policy "jobs_update_own" on public.generation_jobs for update using (auth.uid() = user_id);

drop policy if exists "media_select_own" on public.media_assets;
drop policy if exists "media_insert_own" on public.media_assets;
drop policy if exists "media_update_own" on public.media_assets;
create policy "media_select_own" on public.media_assets for select using (auth.uid() = user_id);
create policy "media_insert_own" on public.media_assets for insert with check (auth.uid() = user_id);
create policy "media_update_own" on public.media_assets for update using (auth.uid() = user_id);

drop policy if exists "events_select_own" on public.job_events;
drop policy if exists "events_insert_own" on public.job_events;
create policy "events_select_own" on public.job_events for select using (auth.uid() = user_id);
create policy "events_insert_own" on public.job_events for insert with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, 'unknown@example.com'))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
`;

const createBucketIfMissing = async (name, isPublic = false) => {
  const res = await serviceApi("/storage/v1/bucket", {
    method: "POST",
    body: JSON.stringify({
      name,
      public: isPublic,
      file_size_limit: null,
      allowed_mime_types: null,
    }),
  });

  if (res.ok) {
    console.log(`Bucket created: ${name}`);
    return;
  }

  if (res.status === 409) {
    console.log(`Bucket already exists: ${name}`);
    return;
  }

  const body = await res.text();
  throw new Error(`Bucket ${name} failed (${res.status}): ${body}`);
};

const ensureSeedUser = async () => {
  const lookup = await serviceApi(`/auth/v1/admin/users?email=${encodeURIComponent(loginEmail)}`);
  if (!lookup.ok) {
    throw new Error(`Failed to query auth users: ${lookup.status} ${await lookup.text()}`);
  }

  const usersPayload = await lookup.json();
  const users = usersPayload.users || [];

  if (users.length > 0) {
    console.log(`Seed user already exists: ${loginEmail}`);
    return;
  }

  const create = await serviceApi("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: loginEmail,
      password: loginPassword,
      email_confirm: true,
      user_metadata: {
        seeded_by: "provision-supabase",
      },
    }),
  });

  if (!create.ok) {
    throw new Error(`Failed to seed auth user: ${create.status} ${await create.text()}`);
  }

  console.log(`Seed user created: ${loginEmail}`);
};

const updateAuthConfig = async () => {
  const res = await projectApi("/config/auth", {
    method: "PATCH",
    body: JSON.stringify({
      disable_signup: true,
      jwt_exp: 3600,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to patch auth config: ${res.status} ${await res.text()}`);
  }

  console.log("Auth config updated (signup disabled).\n");
};

const main = async () => {
  console.log(`Provisioning project ${projectRef}...`);

  const keysRes = await projectApi("/api-keys");
  if (!keysRes.ok) {
    throw new Error(`Unable to fetch API keys: ${keysRes.status} ${await keysRes.text()}`);
  }

  const keys = await keysRes.json();
  const anon = keys.find((key) => key.name === "anon")?.api_key;
  const serviceRole = keys.find((key) => key.name === "service_role")?.api_key;

  if (!anon || !serviceRole) {
    throw new Error("Missing anon/service_role keys in project API response.");
  }

  const sqlRes = await projectApi("/database/query", {
    method: "POST",
    body: JSON.stringify({ query: sql }),
  });

  if (!sqlRes.ok) {
    throw new Error(`SQL provisioning failed: ${sqlRes.status} ${await sqlRes.text()}`);
  }

  console.log("Database schema + RLS provisioned.");

  await createBucketIfMissing("inputs-private", false);
  await createBucketIfMissing("media-library", false);
  await ensureSeedUser();
  await updateAuthConfig();

  const envLocal = `NEXT_PUBLIC_SUPABASE_URL=${projectUrl}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}\nSUPABASE_SERVICE_ROLE_KEY=${serviceRole}\nSUPABASE_SECRET_KEY=${secretKey}\nSUPABASE_PROJECT_REF=${projectRef}\nAPP_LOGIN_EMAIL=${loginEmail}\nAPP_LOGIN_PASSWORD=${loginPassword}\n`;

  await fs.writeFile(".env.supabase.generated", envLocal, "utf8");
  console.log("Wrote .env.supabase.generated with fresh project keys.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
