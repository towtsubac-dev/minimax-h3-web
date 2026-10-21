# Civitai direct-to-R2: Cloudflare Worker rollout plan

Status: DESIGN ONLY. Do not enable direct import for files over 256 MiB until Worker integration is tested.

## Why
The current Vercel API streams the entire Civitai download through a single Vercel Function (115-second abort), and rejects files over 256 MiB. Increasing its size constant alone is not reliable.

## Proposed path
1. Vercel authenticates the existing LoRA admin password, looks up the selected Civitai model-version/file, validates metadata and issues a short-lived HMAC-signed request with the file ID, name, size and SHA-256.
2. Browser submits that signed request directly to a Cloudflare Worker endpoint. The worker verifies the signature and expiry; the admin password and R2 credentials never reach the browser.
3. Worker re-fetches the Civitai version metadata and uses the canonical selected download URL, optionally with CIVITAI_API_TOKEN stored as a Worker secret. Do not accept arbitrary URLs.
4. Worker streams the response in 16 MiB chunks to R2 multipart upload using an R2 bucket binding, incrementally computing SHA-256 and validating safetensors header/offsets; no full-file buffering.
5. Only after size, SHA-256, and safetensors checks pass: complete multipart upload and write library metadata with compatible_models defaulting to erosmax. On any failure abort multipart upload and never publish metadata.
6. Browser shows upload status and refreshes library after completion; if disconnected, treat status as unknown and check library before retrying.

## Important constraints
- HTTP Workers do not have a fixed wall-clock duration while the client remains connected, but disconnections and platform updates can terminate a request. Implement a progress stream/heartbeat and consider a durable retryable queue for robust production operation.
- Cloudflare Worker CPU time and subrequest budgets apply; test on the actual account plan.
- Civitai may return 401/403 for restricted models; an API token might be needed.
- Cloudflare Workers DigestStream supports incremental SHA-256.
- R2 multipart parts must be at least 5 MiB except final part; use 16 MiB.
- Require separate preview Worker and R2 test prefix/bucket, then verify a ~300 MB file end-to-end before enabling production.
- Store shared HMAC secret and Civitai token as Cloudflare Worker secrets and HMAC secret in Vercel; never commit credentials.
- Preserve existing <=256 MiB Vercel import path as a fallback until worker is verified.
- Existing R2 files must never be overwritten or deleted during migration.

## Existing implementation
- api/lora.js: route_lora_civitai_import; currently rejects >256 MiB.
- api/_lora.js: metadata contract, R2 key layout, SHA-256 and size.
- lora-library.html: Civitai import and multipart upload UI.
- PR #8: 512 MiB browser multipart upload + deletion with two-step confirmation.

## Official documentation
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
