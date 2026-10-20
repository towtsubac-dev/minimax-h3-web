import { CompleteMultipartUploadCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { verifyLoraAdminPassword, loraStore, loraKeys, validLoraId } from "./_lora.js";

export default async function handler(req, res) {
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
