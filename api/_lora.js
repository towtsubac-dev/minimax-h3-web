import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { timingSafeEqual } from "node:crypto";

const PREFIX = "loras/library/";
const MAX_LORA_BYTES = 2 * 1024 * 1024 * 1024;

export function verifyLoraAdminPassword(candidate) {
  const expected = process.env.LORA_ADMIN_PASSWORD;
  if (!expected || typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function loraStore() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (![R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME].every(Boolean)) {
    throw new Error("R2 configuration is incomplete.");
  }
  return {
    bucket: R2_BUCKET_NAME,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      forcePathStyle: true
    })
  };
}

export function validLoraId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
}

export function loraKeys(id) {
  if (!validLoraId(id)) throw new Error("Invalid LoRA id.");
  return { metadata: `${PREFIX}${id}.json`, model: `${PREFIX}${id}.safetensors` };
}

export function validateLoraMetadata(data) {
  if (!data || !validLoraId(data.id)) throw new Error("Invalid LoRA id.");
  if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 100) throw new Error("Invalid LoRA name.");
  if (!Number.isSafeInteger(data.size) || data.size < 16 || data.size > MAX_LORA_BYTES) throw new Error("Invalid LoRA file size.");
  if (typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error("Invalid LoRA SHA256.");
  if (!["upload", "civitai"].includes(data.source)) throw new Error("Invalid LoRA source.");
  const compatible_models = data.compatible_models === undefined ? ["erosmax"] : data.compatible_models;
  if (!Array.isArray(compatible_models) || compatible_models.length < 1 ||
      compatible_models.length > 2 || new Set(compatible_models).size !== compatible_models.length ||
      compatible_models.some(model => !["h3", "erosmax"].includes(model))) {
    throw new Error("Invalid compatible models.");
  }
  return { id: data.id, name: data.name.trim(), size: data.size, sha256: data.sha256, source: data.source, created_at: data.created_at || new Date().toISOString(), compatible_models };
}

export async function readLora(id) {
  const { client, bucket } = loraStore();
  const { metadata } = loraKeys(id);
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: metadata }));
  const entry = JSON.parse(await result.Body.transformToString());
  // Legacy library entries are Eros Max-only until explicitly edited.
  return { ...entry, compatible_models: entry.compatible_models ?? ["erosmax"] };
}

export async function listLoras() {
  const { client, bucket } = loraStore();
  const result = [];
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const item of page.Contents || []) {
      const match = item.Key?.match(/^loras\/library\/([a-z0-9][a-z0-9_-]{0,63})\.json$/);
      if (!match) continue;
      try { result.push(await readLora(match[1])); } catch (error) { console.error("Invalid LoRA metadata:", match[1], error); }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return result;
}

export async function saveLoraMetadata(data) {
  const entry = validateLoraMetadata(data);
  const { client, bucket } = loraStore();
  const { metadata, model } = loraKeys(entry.id);
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: model }));
  if (head.ContentLength !== entry.size) throw new Error("Uploaded LoRA size does not match.");
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: metadata, Body: JSON.stringify(entry),
    ContentType: "application/json", IfNoneMatch: "*"
  }));
  return entry;
}

export async function deleteLora(id) {
  const { client, bucket } = loraStore();
  const { metadata, model } = loraKeys(id);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: metadata }));
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: model }));
}
