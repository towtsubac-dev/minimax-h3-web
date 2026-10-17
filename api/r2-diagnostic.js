import { verifyPassword, diagnoseR2, signUpload } from "./_r2.js";
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  if(!verifyPassword(req.body?.password)) return res.status(401).json({error:"パスワードが違います。"});
  try {
    const bucket=await diagnoseR2();
    if(!bucket.ok) return res.status(200).json({bucket,upload_url_check:"skipped"});
    const url=await signUpload("uploads/00000000-0000-4000-8000-000000000000.mp4");
    const parsed=new URL(url);
    const query=parsed.searchParams;
    return res.status(200).json({bucket,upload_url_check:{host:parsed.host,path_prefix:parsed.pathname.startsWith("/"+process.env.R2_BUCKET_NAME+"/"),signature_present:query.has("X-Amz-Signature"),signed_headers:query.get("X-Amz-SignedHeaders"),expires:query.get("X-Amz-Expires")}});
  } catch(error) {
    return res.status(500).json({error:"R2診断に失敗しました。",code:error.name||"Unknown"});
  }
}
