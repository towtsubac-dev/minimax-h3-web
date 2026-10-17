import { verifyPassword, diagnoseR2, signUpload } from "./_r2.js";
import { randomUUID } from "node:crypto";
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  if(!verifyPassword(req.body?.password)) return res.status(401).json({error:"パスワードが違います。"});
  try {
    const bucket=await diagnoseR2();
    if(!bucket.ok) return res.status(200).json({bucket,upload_url_check:"skipped"});
    const url=await signUpload("uploads/"+randomUUID()+".mp4");
    const parsed=new URL(url);
    let preflight;
    try { const response=await fetch(url,{method:"OPTIONS",headers:{"Origin":"https://minimax-h3-web.vercel.app","Access-Control-Request-Method":"PUT","Access-Control-Request-Headers":"content-type"},signal:AbortSignal.timeout(12000)});preflight={status:response.status,allow_origin:response.headers.get("access-control-allow-origin"),allow_methods:response.headers.get("access-control-allow-methods"),allow_headers:response.headers.get("access-control-allow-headers")};}catch(error){preflight={error:error.name||"NetworkError",message:String(error.message||"").slice(0,160)};}
    let put_test;
    try {
      const response=await fetch(url,{method:"PUT",headers:{"Content-Type":"video/mp4","Origin":"https://minimax-h3-web.vercel.app"},body:Buffer.from([0]),signal:AbortSignal.timeout(12000)});
      const body=await response.text();
      put_test={status:response.status,allow_origin:response.headers.get("access-control-allow-origin"),error_code:body.match(/<Code>([^<]+)<\/Code>/)?.[1]||null};
    }catch(error){put_test={error:error.name||"NetworkError",message:String(error.message||"").slice(0,160)};}
    const query=parsed.searchParams;
    return res.status(200).json({bucket,upload_url_check:{host:parsed.host,path_prefix:parsed.pathname.startsWith("/"+process.env.R2_BUCKET_NAME+"/"),signature_present:query.has("X-Amz-Signature"),signed_headers:query.get("X-Amz-SignedHeaders"),expires:query.get("X-Amz-Expires"),preflight,put_test}});
  } catch(error) {
    return res.status(500).json({error:"R2診断に失敗しました。",code:error.name||"Unknown"});
  }
}
