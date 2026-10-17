import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { timingSafeEqual } from "node:crypto";

export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const BUCKET = process.env.R2_BUCKET_NAME;
function config() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_UPLOAD_PASSWORD } = process.env;
  if (![R2_ACCOUNT_ID,R2_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY,BUCKET,R2_UPLOAD_PASSWORD].every(Boolean)) throw new Error("R2環境変数が不足しています。");
  return new S3Client({ region:"auto", endpoint:`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{accessKeyId:R2_ACCESS_KEY_ID,secretAccessKey:R2_SECRET_ACCESS_KEY}, forcePathStyle:true });
}
export function verifyPassword(candidate) {
  const expected=process.env.R2_UPLOAD_PASSWORD;
  if(typeof candidate!=="string"||!expected) return false;
  const a=Buffer.from(candidate),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function validObjectKey(key) {
  return typeof key==="string" && /^uploads\/[0-9a-f]{8}-[0-9a-f-]{27,36}\.mp4$/.test(key);
}
export async function signUpload(key) {
  return getSignedUrl(config(),new PutObjectCommand({Bucket:BUCKET,Key:key,ContentType:"video/mp4"}),{expiresIn:300});
}
export async function signDownload(key) {
  return getSignedUrl(config(),new GetObjectCommand({Bucket:BUCKET,Key:key}),{expiresIn:3600});
}
