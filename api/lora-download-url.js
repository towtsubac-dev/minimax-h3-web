import { verifyPassword, signDownload } from "./_r2.js";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  if (!verifyPassword(req.body?.password)) return res.status(401).json({ error: "認証に失敗しました。" });
  const key = req.body?.key;
  if (typeof key !== "string" || !/^loras\/[0-9a-f-]{36}\.safetensors$/.test(key)) return res.status(400).json({ error: "LoRAキーが不正です。" });
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (![R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME].every(Boolean)) return res.status(500).json({ error: "R2設定が不足しています。" });
  try {
    const client = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, forcePathStyle: true });
    const head = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    if (!head.ContentLength || head.ContentLength > 1024 * 1024 * 1024) return res.status(413).json({ error: "LoRAファイルサイズが不正です。" });
    const download_url = await signDownload(key);
    return res.status(200).json({ key, download_url, size: head.ContentLength });
  } catch (error) {
    console.error("LoRA signing error", error.name);
    return res.status(502).json({ error: "LoRAの取得URLを作成できませんでした。" });
  }
}
