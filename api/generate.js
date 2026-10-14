export default async function handler(req) {
  if (req.method !== "POST") {
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
    const body = req.body;
    const { image, prompt } = body;

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

    const runpodResponse = await fetch(
      "https://api.runpod.ai/v2/18lt7ar99rsrfw/runsync",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RUNPOD_API_KEY}`
        },
        body: JSON.stringify({
          input: {
            action: "h3_generate",
            image: image,
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

    const data = await runpodResponse.json();

    if (!runpodResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "RunPod API error",
          details: data
        }),
        {
          status: runpodResponse.status,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (data.status !== "COMPLETED") {
      return new Response(
        JSON.stringify({
          error: "RunPod job failed",
          details: data
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const outputs = data.output?.outputs || [];

    const video = outputs.find(
      output =>
        output.type === "video" ||
        output.filename?.toLowerCase().endsWith(".mp4")
    );

    if (!video || !video.data) {
      return new Response(
        JSON.stringify({
          error: "生成された動画が見つかりません。",
          details: data.output
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        video_url: `data:video/mp4;base64,${video.data}`
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {
    console.error(error);

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
