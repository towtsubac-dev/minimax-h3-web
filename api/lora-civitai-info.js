import { verifyLoraAdminPassword } from "./_lora.js";

function versionIdFromInput(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  const trimmed = value.trim();
  if (/^[1-9][0-9]{0,11}$/.test(trimmed)) return trimmed;
  let url;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== "https:" || !["civitai.com", "www.civitai.com"].includes(url.hostname)) return null;
  const match = url.pathname.match(/^\/models\/[0-9]+(?:\/[^/]*)?\/?$/);
  if (!match) return null;
  const id = url.searchParams.get("modelVersionId");
  return id && /^[1-9][0-9]{0,11}$/.test(id) ? id : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyLoraAdminPassword(req.body?.password)) return res.status(401).json({ error: "Unauthorized" });
  const id = versionIdFromInput(req.body?.urlOrId);
  if (!id) return res.status(400).json({ error: "CivitaiのモデルバージョンID、またはmodelVersionIdを含むURLを指定してください。" });
  try {
    const response = await fetch("https://civitai.com/api/v1/model-versions/" + id, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return res.status(502).json({ error: "Civitaiのモデル情報を取得できませんでした。HTTP " + response.status });
    const data = await response.json();
    const files = (Array.isArray(data.files) ? data.files : [])
      .filter(f => typeof f.name === "string" && f.name.toLowerCase().endsWith(".safetensors") && Number.isSafeInteger(f.sizeKB) && f.sizeKB > 0)
      .map(f => ({ name: f.name, sizeKB: f.sizeKB, sha256: typeof f.hashes?.SHA256 === "string" ? f.hashes.SHA256.toLowerCase() : null }));
    return res.status(200).json({ versionId: id, modelName: String(data.model?.name || "").slice(0, 120), versionName: String(data.name || "").slice(0, 120), files });
  } catch (error) {
    console.error("Civitai version lookup failed", error);
    return res.status(502).json({ error: "Civitaiへの接続に失敗しました。" });
  }
}
