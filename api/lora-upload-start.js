import { randomUUID } from "node:crypto";
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import { verifyLoraAdminPassword, loraStore, loraKeys } from "./_lora.js";

export default async function handler(req, res) {
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
