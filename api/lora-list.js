import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { verifyPassword } from "./_r2.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  if (!verifyPassword(req.body?.password)) return res.status(401).json({ error: "認証に失敗しました。" });
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (![R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME].every(Boolean)) return res.status(500).json({ error: "R2設定が不足しています。" });
  try {
    const client = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, forcePathStyle: true });
    const data = await client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: "loras/", MaxKeys: 100 }));
    const files = (data.Contents || []).filter(x => /^loras\/[0-9a-f-]{36}\.safetensors$/.test(x.Key || "")).map(x => ({ key: x.Key, size: x.Size, modified: x.LastModified?.toISOString() || null }));
    return res.status(200).json({ files, truncated: !!data.IsTruncated });
  } catch (error) {
    console.error("LoRA list error", error.name);
    return res.status(502).json({ error: "LoRA一覧を取得できませんでした。" });
  }
}
