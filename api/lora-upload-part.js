import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyLoraAdminPassword, loraStore, loraKeys, validLoraId } from "./_lora.js";

export default async function handler(req, res) {
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
