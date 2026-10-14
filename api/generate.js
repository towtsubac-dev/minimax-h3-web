export default async function handler(request) {
  console.log("STEP 1: generate.js started");

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  try {
    console.log("STEP 2: reading request body");

    const body = await request.json();

    console.log("STEP 3: request body received");

    const { image, prompt } = body;

    if (!image) {
      return new Response(
        JSON.stringify({ error: "画像がありません。" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    console.log("STEP 4: image exists");

    const apiKey = process.env.RUNPOD_API_KEY;

    console.log(
      "STEP 5: API key exists:",
      !!apiKey
    );

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "RUNPOD_API_KEY is not configured."
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    console.log("STEP 6: before RunPod fetch");

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      console.log("STEP 7: RunPod fetch timeout");
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
          body: JSON.stringify({
            input: {
              action: "h3_generate",
              image,
              prompt: prompt || "",
              width: 768,
              height: 736,
              length: 124,
              steps: 8,
              seed: Math.floor(Math.random() * 1000000000)
            }
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    console.log(
      "STEP 8: RunPod response received:",
      runpodResponse.status
    );

    const responseText = await runpodResponse.text();

    console.log(
      "STEP 9: RunPod response:",
      responseText
    );

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "RunPodからJSONではないレスポンスが返りました。",
          status: runpodResponse.status,
          response: responseText
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (!runpodResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "RunPod API error",
          status: runpodResponse.status,
          details: data
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (!data.id) {
      return new Response(
        JSON.stringify({
          error: "RunPodからjob IDが返ってきませんでした。",
          details: data
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    console.log(
      "STEP 10: job created:",
      data.id
    );

    return new Response(
      JSON.stringify({
        job_id: data.id,
        status: data.status || "IN_QUEUE"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("GENERATE ERROR:", error);

    return new Response(
      JSON.stringify({
        error: error.name === "AbortError"
          ? "RunPodへの接続が30秒以内に完了しませんでした。"
          : (error.message || "サーバーエラー")
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
