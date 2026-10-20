import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyLoraAdminPassword, readLora, loraStore, loraKeys, validLoraId } from "./_lora.js";

// Administrative test endpoint only. Do not pass admin passwords to RunPod.
// Production generation must use server-side trusted LoRA IDs and issue
// short-lived URLs at dispatch time, without exposing them in browser responses.
export default async function handler(req, res) {
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
