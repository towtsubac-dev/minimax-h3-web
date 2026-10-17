import { randomUUID } from "node:crypto";
import { MAX_VIDEO_BYTES, verifyPassword, signUpload } from "./_r2.js";
export default async function handler(req,res) {
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  res.setHeader("Cache-Control","no-store");
  if(!verifyPassword(req.body?.password)) return res.status(401).json({error:"動画延長パスワードが違います。"});
  const size=Number(req.body?.size);
  if(!Number.isInteger(size)||size<=0||size>MAX_VIDEO_BYTES) return res.status(413).json({error:"MP4は20MiB以下にしてください。"});
  const key="uploads/"+randomUUID()+".mp4";
  try {const upload_url=await signUpload(key);return res.status(200).json({key,upload_url});}
  catch(e){console.error("R2 signing failed",e);return res.status(500).json({error:"R2アップロードURLを作成できませんでした。"});}
}
