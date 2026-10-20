import { createHash } from "node:crypto";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { verifyLoraAdminPassword, loraStore, loraKeys, saveLoraMetadata, validLoraId } from "./_lora.js";

const MAX_HEADER_BYTES = 16 * 1024 * 1024;\n// Full-object hashing remains unsuitable for Vercel execution limits on multi-GB files.
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

export default async function handler(req, res) {
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
