import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

// ─── Clerk JWKS verification ───────────────────────────────────────────────────

const CLERK_ISSUER = "https://clerk.tripsync.live";
const JWKS = createRemoteJWKSet(new URL(`${CLERK_ISSUER}/.well-known/jwks.json`));

async function verifyClerkJwt(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: CLERK_ISSUER,
  });
  if (!payload.sub) {
    throw new Error("Invalid token: missing subject");
  }
  return payload.sub as string;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Verify Clerk JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice(7);
    const clerkUserId = await verifyClerkJwt(token);

    // 2. Parse request body
    const { filename, contentType, entityType, entityId } = await req.json() as {
      filename: string;
      contentType: string;
      entityType: string;
      entityId: string;
    };

    if (!filename || !contentType || !entityType || !entityId) {
      return new Response(JSON.stringify({ error: "Missing required fields: filename, contentType, entityType, entityId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Read R2 credentials from environment
    const accountId = Deno.env.get("R2_ACCOUNT_ID");
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
    const bucketName = Deno.env.get("R2_BUCKET_NAME");
    const publicUrlBase = Deno.env.get("R2_PUBLIC_URL");

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      console.error("Missing R2 credentials in environment");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Generate object key
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${entityType}/${entityId}/${timestamp}-${sanitizedFilename}`;

    // 5. Generate presigned PUT URL using aws4fetch
    const region = "auto";
    const service = "s3";
    const host = `${bucketName}.${accountId}.r2.cloudflarestorage.com`;
    const endpoint = `https://${host}`;
    const expiresIn = 300; // 5 minutes

    const aws = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service,
      region,
    });

    // Build the R2 object URL
    const objectUrl = new URL(`${endpoint}/${key}`);

    // Sign with signQuery=true to get a presigned URL
    // IMPORTANT: Content-Type must be a signed header so the client
    // sends the matching header during the PUT. Without this, R2 returns 403.
    const signedRequest = await aws.sign(
      new Request(objectUrl.toString(), {
        method: "PUT",
        headers: { "Content-Type": contentType },
      }),
      {
        signQuery: true,
        aws: {
          expiresIn,
          unsignedPayload: true, // UNSIGNED-PAYLOAD — correct for presigned uploads
        },
      },
    );

    const uploadUrl = signedRequest.url;

    // Build public URL
    const publicUrl = publicUrlBase
      ? `${publicUrlBase.replace(/\/+$/, "")}/${key}`
      : `https://${host}/${key}`;

    return new Response(JSON.stringify({ uploadUrl, publicUrl, key }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[r2-upload] Error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("token") || message.includes("JWT") ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});