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
      prompt,
      width,
      height,
      mode = "image",
      duration = 5,
      lora = "none",
      loras
    } = req.body || {};

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
              strength: loraDefaults[lora]
            }]
          : [];
    }

    if (!Array.isArray(requestedLoras) || requestedLoras.length > 3) {
      return res.status(400).json({
        error: "追加LoRAの指定が不正です。"
      });
    }

    const normalizedLoras = [];
    const selectedLoraNames = new Set();

    for (const item of requestedLoras) {
      if (!item || typeof item !== "object" ||
          !Object.prototype.hasOwnProperty.call(loraDefaults, item.name)) {
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
          ? loraDefaults[item.name]
          : Number(item.strength);

      if (!Number.isFinite(strength) || strength < 0 || strength > 1.5) {
        return res.status(400).json({
          error: "LoRA強度は0.0〜1.5の範囲で指定してください。"
        });
      }

      normalizedLoras.push({
        name: item.name,
        strength
      });
    }

    if (!["image", "text"].includes(mode)) {
      return res.status(400).json({
        error: "生成モードが不正です。"
      });
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        durationLengths,
        String(duration)
      )
    ) {
      return res.status(400).json({
        error:
          "動画の長さは3秒、5秒、8秒、10秒から選択してください。"
      });
    }

    if (mode === "image" && !image) {
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
        mode === "image"
          ? "h3_generate"
          : "h3_t2v_generate",
      prompt: prompt || "",
      width: safeWidth,
      height: safeHeight,
      length: durationLengths[String(duration)],
      steps: 8,
      seed: Math.floor(Math.random() * 1000000000),
      loras: normalizedLoras
    };

    // 画像モードの場合だけ画像を送信
    if (mode === "image") {
      input.image = image;
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
      loras: input.loras
    }));

    // RunPodへの接続
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000);

    let runpodResponse;

    try {
      runpodResponse = await fetch(
        "https://api.runpod.ai/v2/18lt7ar99rsrfw/run",
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
