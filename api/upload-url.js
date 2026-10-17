import { randomUUID, createHmac } from "node:crypto";
import { MAX_VIDEO_BYTES, verifyPassword } from "./_r2.js";

const WORKER_URL = "https://minimax-h3-upload.towtsubac.workers.dev/upload";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  if (!verifyPassword(req.body?.password)) return res.status(401).json({ error: "動画延長パスワードが違います。" });
  const size = Number(req.body?.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_VIDEO_BYTES) return res.status(413).json({ error: "MP4は20MiB以下にしてください。" });
  const secret = process.env.UPLOAD_SECRET;
  if (!secret) return res.status(500).json({ error: "UPLOAD_SECRET がVercelに設定されていません。" });
  const key = "uploads/" + randomUUID() + ".mp4";
  const expires = String(Math.floor(Date.now() / 1000) + 300);
  const sizeText = String(size);
  const payload = key + "|" + expires + "|" + sizeText;
  const token = createHmac("sha256", secret).update(payload).digest("hex");
  const url = new URL(WORKER_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("expires", expires);
  url.searchParams.set("size", sizeText);
  url.searchParams.set("token", token);
  return res.status(200).json({ key, upload_url: url.toString() });
}
