import { verifyLoraAdminPassword, listLoras } from "./_lora.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) {
    return res.status(401).json({ error: "LoRA管理パスワードが違います。" });
  }
  try {
    const loras = await listLoras();
    return res.status(200).json({ loras });
  } catch (error) {
    console.error("LoRA list failed:", error);
    return res.status(500).json({ error: "LoRA一覧を取得できませんでした。" });
  }
}
