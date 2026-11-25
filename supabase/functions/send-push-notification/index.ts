// Supabase Edge Function: Send Firebase Cloud Messaging (FCM HTTP v1) push notifications
// Deploy with: supabase functions deploy send-push-notification
// Required secrets (set in Supabase Edge Function secrets, NEVER expose to frontend):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   FIREBASE_SERVICE_ACCOUNT (full service account JSON)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PushPayload = {
  recipientId: string;
  senderId: string;
  senderName?: string;
  previewText?: string;
  messageId?: string;
  kind?: "message" | "call";
  callId?: string;
  callType?: "audio" | "video";
};

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getFcmAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const signingInput = `${header}.${claimSet}`;
  const key = await importPkcs8PrivateKey(serviceAccount.private_key);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)),
  );
  const assertion = `${signingInput}.${base64UrlEncode(sig)}`;

  const res = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM OAuth token exchange failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const firebaseSaRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !firebaseSaRaw) {
    return new Response(
      JSON.stringify({ sent: 0, skipped: "Server secrets for Supabase/FCM are not configured." }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Require valid caller Bearer JWT and verify senderId === auth user
  const authHeader = req.headers.get("Authorization") ?? "";
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: userData, error: authErr } = await adminClient.auth.getUser(jwt);
  if (authErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => ({}))) as PushPayload;
  if (
    !body.recipientId ||
    body.senderId !== userData.user.id ||
    body.recipientId === body.senderId
  ) {
    return new Response(JSON.stringify({ error: "Invalid sender or recipient" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Respect blocking, conversation mute, and per-user notification preferences
  const [{ data: blocked }, { data: convSetting }, { data: prefs }, { data: tokens }] =
    await Promise.all([
      adminClient
        .from("rc_blocked_users")
        .select("blocker_id")
        .or(
          `and(blocker_id.eq.${body.recipientId},blocked_id.eq.${body.senderId}),and(blocker_id.eq.${body.senderId},blocked_id.eq.${body.recipientId})`,
        )
        .limit(1),
      adminClient
        .from("rc_conversation_settings")
        .select("muted")
        .eq("user_id", body.recipientId)
        .eq("peer_id", body.senderId)
        .maybeSingle(),
      adminClient
        .from("rc_notification_preferences")
        .select("push_enabled, message_preview, call_alerts, quiet_hours_enabled")
        .eq("user_id", body.recipientId)
        .maybeSingle(),
      adminClient.from("rc_notification_tokens").select("token").eq("user_id", body.recipientId),
    ]);

  if ((blocked?.length ?? 0) > 0 || convSetting?.muted) {
    return new Response(JSON.stringify({ sent: 0, skipped: "muted_or_blocked" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const pushEnabled = prefs ? Boolean(prefs.push_enabled) : true;
  const quietHours = prefs ? Boolean(prefs.quiet_hours_enabled) : false;
  const callAlerts = prefs ? Boolean(prefs.call_alerts) : true;
  const messagePreview = prefs ? Boolean(prefs.message_preview) : true;

  if (!pushEnabled || quietHours || (body.kind === "call" && !callAlerts)) {
    return new Response(JSON.stringify({ sent: 0, skipped: "disabled_by_preferences" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokenList = (tokens ?? []).map((t) => String(t.token)).filter(Boolean);
  if (tokenList.length === 0) {
    return new Response(JSON.stringify({ sent: 0, skipped: "no_tokens" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sa = JSON.parse(firebaseSaRaw) as {
    project_id: string;
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  const accessToken = await getFcmAccessToken(sa);
  const deepLinkPath = `/messages?peer=${encodeURIComponent(body.senderId)}`;
  const title = messagePreview ? body.senderName || "New message" : "New message";
  const bodyText =
    body.kind === "call"
      ? `Incoming ${body.callType === "video" ? "video" : "audio"} call`
      : messagePreview
        ? (body.previewText || "Sent an attachment").slice(0, 140)
        : "Open Reading Corner to read your message";

  let sent = 0;
  const invalidTokens: string[] = [];

  for (const token of tokenList) {
    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: bodyText },
            data: {
              type: body.kind === "call" ? "incoming_call" : "chat_message",
              peerId: body.senderId,
              path: deepLinkPath,
              ...(body.messageId ? { messageId: body.messageId } : {}),
            },
            webpush: {
              fcm_options: { link: deepLinkPath },
              notification: {
                tag: body.kind === "call" ? `rc-call-${body.senderId}` : `rc-chat-${body.senderId}`,
              },
            },
          },
        }),
      },
    );
    if (fcmRes.ok) {
      sent += 1;
    } else {
      const errJson = (await fcmRes.json().catch(() => ({}))) as { error?: { status?: string } };
      const status = errJson.error?.status;
      if (status === "NOT_FOUND" || status === "UNREGISTERED" || status === "INVALID_ARGUMENT") {
        invalidTokens.push(token);
      }
    }
  }

  if (invalidTokens.length > 0) {
    await adminClient.from("rc_notification_tokens").delete().in("token", invalidTokens);
  }

  return new Response(JSON.stringify({ sent, pruned: invalidTokens.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
