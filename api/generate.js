export default async function handler(req, res) {
  console.log("STEP 1: generate.js started");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    console.log("STEP 2: request body received");

    const { image, prompt, width, height } = req.body || {};

    if (!image) {
      return res.status(400).json({
        error: "画像がありません。"
      });
    }

    console.log("STEP 3: image exists");

    const apiKey = process.env.RUNPOD_API_KEY;

    console.log(
      "STEP 4: API key exists:",
      !!apiKey
    );

    if (!apiKey) {
      return res.status(500).json({
        error: "RUNPOD_API_KEY is not configured."
      });
    }

    // RunPodへ送信するデータ
    const payload = {
      input: {
        action: "h3_generate",
        image,
        prompt: prompt || "",
        width: 480,
        height: 760,
        length: 124,
        steps: 8,
        seed: Math.floor(Math.random() * 1000000000)
      }
    };

    // 送信データのサイズを計測
    const payloadBytes = Buffer.byteLength(
      JSON.stringify(payload),
      "utf8"
    );

    console.log(
      "IMAGE BASE64 LENGTH:",
      image.length
    );

    console.log(
      "RUNPOD PAYLOAD BYTES:",
      payloadBytes
    );

    console.log(
      "RUNPOD PAYLOAD MB:",
      (payloadBytes / (1024 * 1024)).toFixed(2)
    );

    console.log("STEP 5: before RunPod fetch");

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      console.log("STEP 6: RunPod fetch timeout");
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

    console.log(
      "STEP 7: RunPod response received:",
      runpodResponse.status
    );

    const responseText = await runpodResponse.text();

    console.log(
      "STEP 8: RunPod response:",
      responseText
    );

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

    console.log(
      "STEP 9: job created:",
      data.id
    );

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
          : (error.message || "サーバーエラー")
    });
  }
}
