// Test-only endpoint: direct MP4 base64 upload, no R2 or password.
// Vercel Functions request body limit is 4.5 MB. Keep below it.
export default async function handler(req,res) {
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const {video,prompt,extend_seconds}=req.body||{};
  if(typeof video!=="string"||!video||video.length>3900000||!/^[A-Za-z0-9+/]+={0,2}$/.test(video)) return res.status(413).json({error:"テスト用MP4は約2.8MiB以下にしてください。"});
  if(typeof prompt!=="string"||!prompt.trim()) return res.status(400).json({error:"プロンプトが必要です。"});
  if(Number(extend_seconds)!==5) return res.status(400).json({error:"ErosMaxの延長は5秒のみです。"});
  const apiKey=process.env.RUNPOD_API_KEY;
  if(!apiKey) return res.status(500).json({error:"RUNPOD_API_KEY is not configured."});
  try {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30000);
    let response;
    try { response=await fetch("https://api.runpod.ai/v2/2gdf5g88h8jsmm/run",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey},body:JSON.stringify({input:{action:"h3_extend_generate",prompt:prompt.trim(),extend_seconds:5,video}}),signal:controller.signal}); }
    finally {clearTimeout(timeout);}
    const data=await response.json();
    if(!response.ok||!data.id) return res.status(502).json({error:"RunPodジョブ登録に失敗しました。",details:data});
    return res.status(200).json({job_id:data.id,model:"erosmax_extend",status:data.status||"IN_QUEUE"});
  }catch(error){return res.status(502).json({error:error.name==="AbortError"?"RunPodへの接続がタイムアウトしました。":"RunPodへの接続に失敗しました。"});}
}
