import { listLoras } from "./_lora.js";

// Read-only selection list. Never return storage keys, hashes, or signed URLs.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const loras = await listLoras();
    return res.status(200).json({
      loras: loras.map(item => ({ id: item.id, name: item.name }))
        .filter(item => typeof item.id === "string" && typeof item.name === "string")
    });
  } catch (error) {
    console.error("LoRA selection list failed:", error);
    return res.status(500).json({ error: "LoRA一覧を取得できませんでした。" });
  }
}
