import { verifyLoraAdminPassword, listLoras, loraStore, loraKeys, validLoraId, saveLoraMetadata, readLora } from "./_lora.js";
import { randomUUID, createHash } from "node:crypto";
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, HeadObjectCommand, AbortMultipartUploadCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// lora-list

async function route_lora_list(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) {
    return res.status(401).json({ error: "LoRA管理パスワードが違います。" });
  }
  try {
    const loras = await listLoras();
    return res.status(200).json({ loras });
  } catch (error) {
    console.error("LoRA list failed:", error);
    return res.status(500).json({ error: "LoRA一覧を取得できませんでした。" });
  }
}


// lora-upload-start



async function route_lora_upload_start(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const name = req.body?.name, size = req.body?.size;
  if (typeof name !== "string" || !name.trim() || name.length > 100 ||
      !Number.isSafeInteger(size) || size < 16 || size > 2 * 1024 ** 3)
    return res.status(400).json({ error: "Invalid LoRA name or size (max 2 GiB)" });
  try {
    const id = randomUUID(), key = loraKeys(id).model;
    const { client, bucket } = loraStore();
    const result = await client.send(new CreateMultipartUploadCommand({
      Bucket: bucket, Key: key, ContentType: "application/octet-stream",
      Metadata: { "lora-name": encodeURIComponent(name.trim()).slice(0, 300) }
    }));
    return res.status(200).json({ id, uploadId: result.UploadId, size, partSize: 16 * 1024 * 1024 });
  } catch (error) {
    console.error("LoRA multipart start failed", error);
    return res.status(500).json({ error: "Could not start upload" });
  }
}


// lora-upload-part



async function route_lora_upload_part(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const { id, uploadId, partNumber } = req.body || {};
  if (!validLoraId(id) || typeof uploadId !== "string" || !uploadId || uploadId.length > 1024 ||
      !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10000)
    return res.status(400).json({ error: "Invalid upload parameters" });
  try {
    const { client, bucket } = loraStore();
    const url = await getSignedUrl(client, new UploadPartCommand({
      Bucket: bucket, Key: loraKeys(id).model, UploadId: uploadId, PartNumber: partNumber
    }), { expiresIn: 300 });
    return res.status(200).json({ url, partNumber });
  } catch (error) {
    console.error("LoRA part signing failed", error);
    return res.status(500).json({ error: "Could not sign part" });
  }
}


// lora-upload-finish


async function route_lora_upload_finish(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const { id, uploadId, parts, size } = req.body || {};
  if (!validLoraId(id) || typeof uploadId !== "string" || !uploadId || uploadId.length > 1024 ||
      !Number.isSafeInteger(size) || size < 16 || size > 2 * 1024 ** 3 ||
      !Array.isArray(parts) || parts.length < 1 || parts.length > 128 ||
      parts.some((p, i) => !p || p.PartNumber !== i + 1 || typeof p.ETag !== "string" ||
        !/^"?[a-fA-F0-9]{32}"?$/.test(p.ETag)))
    return res.status(400).json({ error: "Invalid multipart completion" });
  try {
    const { client, bucket } = loraStore(), key = loraKeys(id).model;
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts }
    }));
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ContentLength !== size) return res.status(409).json({ error: "Uploaded file size mismatch" });
    // Upload completion alone does not register the LoRA. File signature and SHA256
    // must be verified before publishing metadata in the library.
    return res.status(200).json({ id, size, status: "uploaded_unverified" });
  } catch (error) {
    console.error("LoRA multipart completion failed", error);
    return res.status(500).json({ error: "Could not complete upload" });
  }
}


// lora-upload-abort


async function route_lora_upload_abort(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const { id, uploadId } = req.body || {};
  if (!validLoraId(id) || typeof uploadId !== "string" || !uploadId || uploadId.length > 1024)
    return res.status(400).json({ error: "Invalid upload parameters" });
  try {
    const { client, bucket } = loraStore();
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: loraKeys(id).model, UploadId: uploadId }));
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("LoRA multipart abort failed", error);
    return res.status(500).json({ error: "Could not abort upload" });
  }
}


// lora-register



const MAX_HEADER_BYTES = 16 * 1024 * 1024;
// Full-object hashing remains unsuitable for Vercel execution limits on multi-GB files.
const MAX_BYTES = 2 * 1024 ** 3;

function inspectHeader(buffer) {
  if (buffer.length < 8) throw new Error("Safetensors header is missing");
  const length = Number(buffer.readBigUInt64LE(0));
  if (!Number.isSafeInteger(length) || length < 2 || length > MAX_HEADER_BYTES) throw new Error("Invalid safetensors header length");
  if (buffer.length < length + 8) return { length, complete: false };
  let parsed;
  try { parsed = JSON.parse(buffer.subarray(8, length + 8).toString("utf8")); }
  catch { throw new Error("Invalid safetensors JSON header"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid safetensors metadata");
  const tensors = Object.entries(parsed).filter(([key]) => key !== "__metadata__");
  if (!tensors.length) throw new Error("No tensors in safetensors file");
  const intervals = [];
  for (const [key, tensor] of tensors) {
    if (!key || !tensor || !Array.isArray(tensor.data_offsets) || tensor.data_offsets.length !== 2 ||
        !Array.isArray(tensor.shape) || typeof tensor.dtype !== "string") throw new Error("Invalid tensor descriptor");
    const [start, end] = tensor.data_offsets;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw new Error("Invalid tensor offsets");
    intervals.push([start, end]);
  }
  intervals.sort((a,b) => a[0]-b[0]);
  let last = 0;
  for (const [start,end] of intervals) {
    if (start !== last) throw new Error("Noncontiguous safetensors offsets");
    last = end;
  }
  return { length, complete: true, tensorBytes: last };
}

async function verifyObject(client, bucket, key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const expected = Number(response.ContentLength);
  if (!Number.isSafeInteger(expected) || expected < 16 || expected > MAX_BYTES) throw new Error("Invalid file size");
  const hash = createHash("sha256");
  let bytes = 0, header = Buffer.alloc(0), headerInfo = null;
  for await (const piece of response.Body) {
    const chunk = Buffer.from(piece);
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("LoRA file exceeds limit");
    hash.update(chunk);
    if (!headerInfo?.complete) {
      // Append only the header bytes needed; never buffer tensor payloads.
      const required = headerInfo ? headerInfo.length + 8 : 8;
      const firstTake = Math.min(chunk.length, Math.max(0, required - header.length));
      if (firstTake) header = Buffer.concat([header, chunk.subarray(0, firstTake)]);
      if (header.length >= 8 && !headerInfo) headerInfo = inspectHeader(header);
      if (headerInfo && !headerInfo.complete) {
        const needed = headerInfo.length + 8 - header.length;
        const extra = Math.min(needed, chunk.length - firstTake);
        if (extra > 0) header = Buffer.concat([header, chunk.subarray(firstTake, firstTake + extra)]);
        if (header.length >= headerInfo.length + 8) headerInfo = inspectHeader(header);
      }
    }
  }
  if (bytes !== expected || !headerInfo?.complete || headerInfo.tensorBytes !== bytes - 8 - headerInfo.length)
    throw new Error("Safetensors file is incomplete or invalid");
  return { size: bytes, sha256: hash.digest("hex") };
}

async function route_lora_register(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const { id, name } = req.body || {};
  if (!validLoraId(id) || typeof name !== "string" || !name.trim() || name.length > 100)
    return res.status(400).json({ error: "Invalid LoRA registration" });
  try {
    const { client, bucket } = loraStore();
    const { model } = loraKeys(id);
    const verified = await verifyObject(client, bucket, model);
    const entry = await saveLoraMetadata({ id, name, ...verified, source: "upload" });
    return res.status(200).json({ lora: entry });
  } catch (error) {
    console.error("LoRA registration verification failed", error);
    return res.status(422).json({ error: "LoRAファイルの検証・登録に失敗しました。" });
  }
}


// lora-civitai-info

function versionIdFromInput(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  const trimmed = value.trim();
  if (/^[1-9][0-9]{0,11}$/.test(trimmed)) return trimmed;
  let url;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== "https:" || !["civitai.com", "www.civitai.com"].includes(url.hostname)) return null;
  const match = url.pathname.match(/^\/models\/[0-9]+(?:\/[^/]*)?\/?$/);
  if (!match) return null;
  const id = url.searchParams.get("modelVersionId");
  return id && /^[1-9][0-9]{0,11}$/.test(id) ? id : null;
}

async function route_lora_civitai_info(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const id = versionIdFromInput(req.body?.urlOrId);
  if (!id) return res.status(400).json({ error: "CivitaiのモデルバージョンID、またはmodelVersionIdを含むURLを指定してください。" });
  try {
    const response = await fetch("https://civitai.com/api/v1/model-versions/" + id, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return res.status(502).json({ error: "Civitaiのモデル情報を取得できませんでした。HTTP " + response.status });
    const data = await response.json();
    const files = (Array.isArray(data.files) ? data.files : [])
      .filter(f => typeof f.name === "string" && f.name.toLowerCase().endsWith(".safetensors") && Number.isFinite(Number(f.sizeKB)) && Number(f.sizeKB) > 0)
      .map(f => ({ name: f.name, sizeKB: Number(f.sizeKB), sha256: typeof f.hashes?.SHA256 === "string" ? f.hashes.SHA256.toLowerCase() : null }));
    return res.status(200).json({ versionId: id, modelName: String(data.model?.name || "").slice(0, 120), versionName: String(data.name || "").slice(0, 120), files });
  } catch (error) {
    console.error("Civitai version lookup failed", error);
    return res.status(502).json({ error: "Civitaiへの接続に失敗しました。" });
  }
}


// lora-download-test



// Administrative test endpoint only. Do not pass admin passwords to RunPod.
// Production generation must use server-side trusted LoRA IDs and issue
// short-lived URLs at dispatch time, without exposing them in browser responses.
async function route_lora_download_test(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const id = req.body?.id;
  if (!validLoraId(id)) return res.status(400).json({ error: "Invalid LoRA ID" });
  try {
    const entry = await readLora(id);
    if (entry.id !== id || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size) || entry.size < 16 || entry.size > 2 * 1024 ** 3)
      return res.status(422).json({ error: "Invalid LoRA metadata" });
    const { client, bucket } = loraStore();
    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket, Key: loraKeys(id).model
    }), { expiresIn: 600 });
    return res.status(200).json({ id, name: entry.name, size: entry.size, sha256: entry.sha256, url, expiresIn: 600 });
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404)
      return res.status(404).json({ error: "LoRA not found" });
    console.error("LoRA download signing failed", error);
    return res.status(500).json({ error: "Could not create LoRA download URL" });
  }
}


// lora-options

// Read-only selection list. Never return storage keys, hashes, or signed URLs.
async function route_lora_options(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const loras = await listLoras();
    return res.status(200).json({
      loras: loras.map(item => ({ id: item.id, name: item.name }))
        .filter(item => typeof item.id === "string" && typeof item.name === "string")
    });
  } catch (error) {
    console.error("LoRA selection list failed:", error);
    return res.status(500).json({ error: "LoRA一覧を取得できませんでした。" });
  }
}


const routes = {
  "list": route_lora_list,
  "upload-start": route_lora_upload_start,
  "upload-part": route_lora_upload_part,
  "upload-finish": route_lora_upload_finish,
  "upload-abort": route_lora_upload_abort,
  "register": route_lora_register,
  "civitai-info": route_lora_civitai_info,
  "download-test": route_lora_download_test,
  "options": route_lora_options,
};
export default async function handler(req, res) {
  const action = req.query?.action;
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(routes, action)) {
    return res.status(404).json({ error: "Unknown LoRA action" });
  }
  return routes[action](req, res);
}
