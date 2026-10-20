import { AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { verifyLoraAdminPassword, loraStore, loraKeys, validLoraId } from "./_lora.js";

export default async function handler(req, res) {
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
