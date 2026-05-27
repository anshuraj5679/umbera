import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { canonicalize, digest } from "./signer.js";

const s3 = new S3Client({ region: process.env.S3_REGION ?? "ap-south-1" });

export async function writeAuditLog(bucket: string, key: string, body: any, signMessage: (msg: string) => Promise<string>) {
  const d = digest(body);
  const signature = await signMessage(d);
  const payload = { ...body, signature, digest: d };
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key,
    Body: canonicalize(payload),
    ContentType: "application/json",
    ServerSideEncryption: "AES256",
  }));
  return key;
}
