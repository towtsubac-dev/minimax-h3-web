# Civitai → R2 Import Worker (preview)

This is a **non-destructive, disabled-by-default scaffold**, not a working importer.
The /health endpoint reports whether the R2 binding and signing secret are configured.
Every other request returns 503. Do not route production traffic here.

## Cloudflare preview setup

1. Create a separate preview Worker from this folder using Wrangler.
2. Add an R2 bucket binding named `LORA_BUCKET` pointing to a **test bucket** (or an isolated test prefix after implementation); never use production during initial tests.
3. Add Worker secret `LORA_IMPORT_SIGNING_SECRET` with a strong random value.
4. Deploy and GET /health; check that both booleans are true and import_enabled is false.
5. Next: implement HMAC request validation, Civitai API lookup and streaming multipart upload, safetensors validation, SHA-256 verification, and browser progress UI.
6. Only then test a 298.26MB file and consider enabling imports.

See docs/civitai-direct-r2-worker.md for the integration design.
