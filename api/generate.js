export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  try {
    const { image, prompt } = await request.json();

    if (!image) {
      return new Response(
        JSON.stringify({ error: "画像がありません。" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const apiKey = process.env.RUNPOD_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "RUNPOD_API_KEY is not configured."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const runpodResponse = await fetch(
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
        })
      }
    );

    const responseText = await runpodResponse.text();

    console.log("RunPod run HTTP:", runpodResponse.status);
    console.log("RunPod run response:", responseText);

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
          headers: {
            "Content-Type": "application/json"
          }
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
          headers: {
            "Content-Type": "application/json"
          }
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
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

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
    console.error("generate error:", error);

    return new Response(
      JSON.stringify({
        error: error.message || "サーバーエラー"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
