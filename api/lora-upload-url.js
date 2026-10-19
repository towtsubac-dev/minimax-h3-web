import { randomUUID, createHmac } from "node:crypto";
import { verifyPassword } from "./_r2.js";

const MAX_LORA_BYTES = 90 * 1024 * 1024;
const WORKER_URL = "https://minimax-h3-upload.towtsubac.workers.dev/lora";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  if (!verifyPassword(req.body?.password)) return res.status(401).json({ error: "認証に失敗しました。" });
  const size = Number(req.body?.size);
  const filename = req.body?.filename;
  if (typeof filename !== "string" || !filename.toLowerCase().endsWith(".safetensors")) return res.status(400).json({ error: ".safetensors ファイルを選択してください。" });
  if (!Number.isSafeInteger(size) || size < 16 || size > MAX_LORA_BYTES) return res.status(413).json({ error: "LoRAは90MiB以下にしてください。" });
  const secret = process.env.UPLOAD_SECRET;
  if (!secret) return res.status(500).json({ error: "UPLOAD_SECRET が設定されていません。" });
  const key = "loras/" + randomUUID() + ".safetensors";
  const expires = String(Math.floor(Date.now() / 1000) + 300);
  const sizeText = String(size);
  const token = createHmac("sha256", secret).update(key + "|" + expires + "|" + sizeText).digest("hex");
  const url = new URL(WORKER_URL);
  for (const [k, v] of Object.entries({ key, expires, size: sizeText, token })) url.searchParams.set(k, v);
  return res.status(200).json({ key, upload_url: url.toString(), max_bytes: MAX_LORA_BYTES });
}
