# RunPod Media Studio

Production Next.js app for generating AI videos/images with RunPod and storing results in Supabase.

## Features

- Email/password auth via Supabase Auth.
- Mode matrix:
  - `video:t2v` -> `wan-2-6-t2v`
  - `video:i2v` -> `wan-2-6-i2v`
  - `image:flux` -> `black-forest-labs-flux-1-kontext-dev`
  - `image:qwen` -> `qwen-image-edit`
- Async RunPod flow (`/run` + `/status/{job_id}`) with persisted queue state.
- Supabase-backed queue/history (`generation_jobs`, `job_events`) + media catalog (`media_assets`).
- Input uploads to private bucket and signed URL handoff to RunPod.
- Output ingestion from RunPod URL into durable Supabase storage.
- Premium animated UI stack: `ogl`, `curtainsjs`, `react-vfx`, `postprocessing`, `lenis`, `locomotive-scroll`, `gsap`, `cannon-es`.

## Provisioning

1. Set env vars:

```bash
cp .env.example .env.local
```

2. Run Supabase provisioning (schema + RLS + buckets + seed auth user):

```bash
SUPABASE_ACCESS_TOKEN=<sbp_...> \
SUPABASE_PROJECT_REF=<project_ref> \
SUPABASE_SECRET_KEY=<sb_secret_...> \
APP_LOGIN_EMAIL=Logantbaird@gmail.com \
APP_LOGIN_PASSWORD='Kilkinny!982' \
npm run provision:supabase
```

3. Copy generated keys into `.env.local`:

```bash
cat .env.supabase.generated
```

4. Add:

- `RUNPOD_API_KEY`
- `NEXT_PUBLIC_APP_ORIGIN`

## Local Development

```bash
npm install
npm run lint
npm run build
npm run dev
```

## API Endpoints

- `POST /api/jobs` (multipart form)
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs/:id/poll`
- `GET /api/library`

`Authorization: Bearer <supabase_access_token>` is supported for API calls.

## Smoke Test (RunPod)

```bash
RUNPOD_API_KEY=<rpa_...> npm run smoke:runpod
```

This submits one real job per model and polls to terminal status.

## Deployment (Vercel)

- Link/import repo `Flickinny11/videos-are-a-thing` in Vercel.
- Set production env vars from `.env.local`.
- Production branch: `main`.
- Every merge to `main` auto-deploys.
- Auto-deploy verification timestamp: 2026-03-12.

## Security

Credentials are environment-based only. Do not commit `.env.local` or generated key files.
Rotate tokens after deployment if they were shared in plaintext.
