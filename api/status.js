export default async function handler(request) {
  if (request.method !== "GET") {
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
    const url = new URL(request.url);
    const jobId = url.searchParams.get("job_id");

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "job_idがありません。" }),
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
      `https://api.runpod.ai/v2/18lt7ar99rsrfw/status/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      }
    );

    const responseText = await runpodResponse.text();

    console.log("RunPod status HTTP:", runpodResponse.status);
    console.log("RunPod status response:", responseText);

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

    return new Response(
      JSON.stringify(data),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("status error:", error);

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
