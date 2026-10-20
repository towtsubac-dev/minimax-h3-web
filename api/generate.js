import { readLora, loraStore, loraKeys, validLoraId } from "./_lora.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyPassword, validObjectKey, signDownload } from "./_r2.js";
export default async function handler(req, res) {
  console.log("STEP 1: generate.js started");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      image,
      image_url,
      model = "h3",
      lora_strength = 0.8,
      prompt,
      width,
      height,
      mode = "image",
      duration = 5,
      lora = "none",
      loras,
      video,
      video_key,
      upload_password,
      extend_seconds
    } = req.body || {};

    if (!["h3", "erosmax"].includes(model)) return res.status(400).json({ error: "モデル指定が不正です。" });
    if (model === "erosmax" && ![5].includes(Number(duration))) return res.status(400).json({ error: "Eros Maxは現在5秒のみ対応しています。" });
    if (model === "erosmax" && mode === "image" && !image) return res.status(400).json({ error: "Eros Max用の画像がありません。" });
    if (model === "erosmax" && (!Number.isFinite(Number(lora_strength)) || Number(lora_strength) < 0 || Number(lora_strength) > 2)) return res.status(400).json({ error: "Eros MaxのLoRA強度が不正です。" });

    // 秒数からH3のフレーム数へ変換
    const durationLengths = {
      3: 76,
      5: 124,
      8: 196,
      10: 244
    };

    const loraDefaults = {
      hmnsfw: 0.7,
      free_pussy: 1.0,
      hmpenis: 1.0
    };

    // Keep compatibility with older clients that send a single "lora" value.
    let requestedLoras = loras;
    if (requestedLoras === undefined) {
      requestedLoras =
        lora && lora !== "none"
          ? [{
              name: lora,
              strength: model === "erosmax" ? Number(lora_strength) : loraDefaults[lora]
            }]
          : [];
    }

    // Preserve Eros Max LoRA selections.
    if (!Array.isArray(requestedLoras) || requestedLoras.length > 3) {
      return res.status(400).json({
        error: "追加LoRAの指定が不正です。"
      });
    }

    const allowedLoras = model === "erosmax" ? {} : loraDefaults;
    if (requestedLoras.length > (model === "erosmax" ? 2 : 3)) return res.status(400).json({error:"追加LoRAの数が多すぎます。"});
    const normalizedLoras = [];
    const selectedLoraNames = new Set();

    for (const item of requestedLoras) {
      if (!item || typeof item !== "object" ||
          !(Object.prototype.hasOwnProperty.call(allowedLoras, item.name) || (typeof item.name === "string" && item.name.startsWith("library:") && validLoraId(item.name.slice(8))))) {
        return res.status(400).json({
          error: "追加LoRAの指定が不正です。"
        });
      }

      if (selectedLoraNames.has(item.name)) {
        return res.status(400).json({
          error: "同じLoRAを重複して指定できません。"
        });
      }
      selectedLoraNames.add(item.name);

      const strength =
        item.strength === undefined
          ? (allowedLoras[item.name] ?? 1.0)
          : Number(item.strength);

      if (!Number.isFinite(strength) || strength < 0 || strength > (model === "erosmax" ? 2 : 1.5)) {
        return res.status(400).json({
          error: "LoRA強度は0.0〜1.5の範囲で指定してください。"
        });
      }

      normalizedLoras.push({
        name: item.name,
        strength
      });
    }

    if (!["image", "text", "extend"].includes(mode)) {
      return res.status(400).json({
        error: "生成モードが不正です。"
      });
    }

    if (mode === "extend" && ![3, 5, 8, 10].includes(Number(extend_seconds))) {
      return res.status(400).json({ error: "延長時間は3秒、5秒、8秒、10秒から選択してください。" });
    }

    if (mode === "extend" && !String(prompt || "").trim()) {
      return res.status(400).json({ error: "延長用プロンプトを入力してください。" });
    }

    if (mode === "extend" && !validObjectKey(video_key)) {
      return res.status(400).json({ error: "延長する動画がありません。" });
    }

    if (mode === "extend" && !verifyPassword(upload_password)) {
      return res.status(401).json({ error: "動画延長パスワードが違います。" });
    }

    if (
      mode !== "extend" && !Object.prototype.hasOwnProperty.call(
        durationLengths,
        String(duration)
      )
    ) {
      return res.status(400).json({
        error:
          "動画の長さは3秒、5秒、8秒、10秒から選択してください。"
      });
    }

    if (model === "h3" && mode === "image" && !image) {
      return res.status(400).json({
        error: "画像がありません。"
      });
    }

    if (
      mode === "text" &&
      !String(prompt || "").trim()
    ) {
      return res.status(400).json({
        error: "プロンプトを入力してください。"
      });
    }

    // Diagnostic logging: record settings only, never prompt or image data.
    console.log("H3 REQUEST SETTINGS:", JSON.stringify({
      mode,
      duration: Number(duration),
      requestedLoras: Array.isArray(requestedLoras) ? requestedLoras : null,
      normalizedLoras
    }));

    const apiKey = process.env.RUNPOD_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "RUNPOD_API_KEY is not configured."
      });
    }

    // MiniMax H3 解像度設定
    const MAX_WIDTH = 1344;
    const MAX_HEIGHT = 1344;
    const MAX_PIXELS = 768 * 1344;
    const STEP = 32;

    let safeWidth =
      Math.round(Number(width || 768) / STEP) * STEP;

    let safeHeight =
      Math.round(Number(height || 768) / STEP) * STEP;

    safeWidth = Math.max(
      STEP,
      Math.min(MAX_WIDTH, safeWidth)
    );

    safeHeight = Math.max(
      STEP,
      Math.min(MAX_HEIGHT, safeHeight)
    );

    // 最大キャンバス面積を超えないように調整
    if (safeWidth * safeHeight > MAX_PIXELS) {
      const scale = Math.sqrt(
        MAX_PIXELS / (safeWidth * safeHeight)
      );

      safeWidth =
        Math.floor((safeWidth * scale) / STEP) * STEP;

      safeHeight =
        Math.floor((safeHeight * scale) / STEP) * STEP;

      safeWidth = Math.max(STEP, safeWidth);
      safeHeight = Math.max(STEP, safeHeight);
    }

    console.log(
      "H3 RESOLUTION:",
      `${safeWidth}x${safeHeight}`
    );

    // RunPodへ送信する入力
    const input = {
      action:
        mode === "extend" ? "h3_extend_generate" :
        mode === "image" ? "h3_generate" : "h3_t2v_generate",
      prompt: prompt || "",
      width: safeWidth,
      height: safeHeight,
      length: durationLengths[String(duration)],
      steps: 8,
      seed: Math.floor(Math.random() * 1000000000),
      loras: normalizedLoras
    };

    if (model === "erosmax") {
      if (mode !== "extend") input.action = mode === "image" ? "h3_i2v_generate" : "h3_t2v_generate";
      if (mode === "image") input.image = image;
    }

    input.loras = await Promise.all(normalizedLoras.map(async item => {
        if (!item.name.startsWith("library:")) return item;
        const id = item.name.slice(8);
        let entry;
        try { entry = await readLora(id); }
        catch { throw new Error("登録LoRAが見つかりません: " + id); }
        if (!Array.isArray(entry.compatible_models) || !entry.compatible_models.includes(model))
          throw new Error("選択したモデルに登録されていないLoRAです: " + id);
        if (entry.id !== id || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
            !Number.isSafeInteger(entry.size) || entry.size < 16 || entry.size > 2 * 1024 ** 3)
          throw new Error("登録LoRAのメタデータが不正です。");
        const { client, bucket } = loraStore();
        const url = await getSignedUrl(client, new GetObjectCommand({
          Bucket: bucket, Key: loraKeys(id).model
        }), { expiresIn: 3600 });
        return { ...item, registered: { id, sha256: entry.sha256, size: entry.size, url } };
      }));

    // 画像・動画は必要なモードでのみ送信する
    if (model === "h3" && mode === "image") input.image = image;
    if (mode === "extend") {
      input.video_url = await signDownload(video_key);
      input.extend_seconds = Number(extend_seconds);
    }

    const payload = { input };

    const payloadBytes = Buffer.byteLength(
      JSON.stringify(payload),
      "utf8"
    );

    console.log(
      "RUNPOD PAYLOAD MB:",
      (payloadBytes / (1024 * 1024)).toFixed(2)
    );

    console.log("RUNPOD INPUT SETTINGS:", JSON.stringify({
      action: input.action,
      length: input.length,
      loras: input.loras.map(({ name, strength }) => ({ name, strength }))
    }));

    // RunPodへの接続
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000);

    let runpodResponse;

    try {
      runpodResponse = await fetch(
        `https://api.runpod.ai/v2/${model === "erosmax" ? (process.env.VERCEL_ENV === "preview" && ["feature/eros-lora-library", "feature/r2-only-eros-loras"].includes(process.env.VERCEL_GIT_COMMIT_REF) ? "qdu7le19os7loq" : "2gdf5g88h8jsmm") : "18lt7ar99rsrfw"}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await runpodResponse.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: "RunPodからJSONではないレスポンスが返りました。",
        status: runpodResponse.status,
        response: responseText
      });
    }

    if (!runpodResponse.ok) {
      return res.status(502).json({
        error: "RunPod API error",
        status: runpodResponse.status,
        details: data
      });
    }

    if (!data.id) {
      return res.status(502).json({
        error: "RunPodからjob IDが返ってきませんでした。",
        details: data
      });
    }

    console.log("Job created:", data.id);

    return res.status(200).json({
      job_id: data.id,
      model,
      status: data.status || "IN_QUEUE"
    });
  } catch (error) {
    console.error("GENERATE ERROR:", error);

    return res.status(500).json({
      error:
        error.name === "AbortError"
          ? "RunPodへの接続が30秒以内に完了しませんでした。"
          : error.message || "サーバーエラー"
    });
  }
}
