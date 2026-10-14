export default async function handler(req, res) {
  console.log("STEP 1: generate.js started");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    console.log("STEP 2: request body received");

    const {
      image,
      prompt,
      width,
      height
    } = req.body || {};

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

    // ---------------------------------------------------------
    // MiniMax H3 resolution
    //
    // H3 uses dimensions in multiples of 32.
    // Maximum canvas:
    //   768 x 1344
    //
    // The frontend already calculates the aspect-ratio-preserving
    // resolution. Here we only validate and normalize it.
    // ---------------------------------------------------------

    const MAX_WIDTH = 1344;
    const MAX_HEIGHT = 1344;
    const MAX_PIXELS = 768 * 1344;
    const STEP = 32;

    let safeWidth = Math.round(
      Number(width || 768) / STEP
    ) * STEP;

    let safeHeight = Math.round(
      Number(height || 768) / STEP
    ) * STEP;

    safeWidth = Math.max(
      STEP,
      Math.min(MAX_WIDTH, safeWidth)
    );

    safeHeight = Math.max(
      STEP,
      Math.min(MAX_HEIGHT, safeHeight)
    );

    // ---------------------------------------------------------
    // Enforce maximum H3 canvas area
    // ---------------------------------------------------------

    if (
      safeWidth * safeHeight >
      MAX_PIXELS
    ) {

      const scale = Math.sqrt(
        MAX_PIXELS /
        (safeWidth * safeHeight)
      );

      safeWidth =
        Math.floor(
          (safeWidth * scale) / STEP
        ) * STEP;

      safeHeight =
        Math.floor(
          (safeHeight * scale) / STEP
        ) * STEP;

      safeWidth = Math.max(
        STEP,
        safeWidth
      );

      safeHeight = Math.max(
        STEP,
        safeHeight
      );
    }

    console.log(
      "H3 RESOLUTION:",
      `${safeWidth}x${safeHeight}`
    );

    // ---------------------------------------------------------
    // RunPod payload
    // ---------------------------------------------------------

    const payload = {
      input: {
        action: "h3_generate",
        image,
        prompt: prompt || "",
        width: safeWidth,
        height: safeHeight,
        length: 124,
        steps: 8,
        seed: Math.floor(
          Math.random() * 1000000000
        )
      }
    };

    const payloadBytes =
      Buffer.byteLength(
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
      (
        payloadBytes /
        (1024 * 1024)
      ).toFixed(2)
    );

    console.log(
      "STEP 5: before RunPod fetch"
    );

    // ---------------------------------------------------------
    // RunPod request timeout
    // ---------------------------------------------------------

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {

        console.log(
          "STEP 6: RunPod fetch timeout"
        );

        controller.abort();

      }, 30000);


    let runpodResponse;

    try {

      runpodResponse =
        await fetch(
          "https://api.runpod.ai/v2/18lt7ar99rsrfw/run",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Authorization":
                `Bearer ${apiKey}`
            },

            body:
              JSON.stringify(payload),

            signal:
              controller.signal
          }
        );

    } finally {

      clearTimeout(timeout);
    }


    console.log(
      "STEP 7: RunPod response received:",
      runpodResponse.status
    );


    const responseText =
      await runpodResponse.text();


    console.log(
      "STEP 8: RunPod response:",
      responseText
    );


    let data;


    try {

      data =
        JSON.parse(responseText);

    } catch {

      return res.status(502).json({
        error:
          "RunPodからJSONではないレスポンスが返りました。",

        status:
          runpodResponse.status,

        response:
          responseText
      });
    }


    if (!runpodResponse.ok) {

      return res.status(502).json({
        error:
          "RunPod API error",

        status:
          runpodResponse.status,

        details:
          data
      });
    }


    if (!data.id) {

      return res.status(502).json({
        error:
          "RunPodからjob IDが返ってきませんでした。",

        details:
          data
      });
    }


    console.log(
      "STEP 9: job created:",
      data.id
    );


    return res.status(200).json({

      job_id:
        data.id,

      status:
        data.status || "IN_QUEUE"
    });


  } catch (error) {

    console.error(
      "GENERATE ERROR:",
      error
    );


    return res.status(500).json({

      error:
        error.name === "AbortError"
          ? "RunPodへの接続が30秒以内に完了しませんでした。"
          : (
              error.message ||
              "サーバーエラー"
            )
    });
  }
}
