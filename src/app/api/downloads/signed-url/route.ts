import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Object keys in the 'paid-releases' Supabase Storage bucket.
// Each key maps a product ID to the filename stored in the bucket.
const PRODUCT_FILES: Record<string, string> = {
  'sports-steve-bet-buddy': 'SportsSteveAndBetBuddy-Windows-x64.exe',
  'draymond-orchestrator': 'DraymondOrchestrator-Windows-x64.exe',
  'open-chat': 'OpenChat-Windows-x64.exe', // placeholder — not yet uploaded
};

// Signed URL valid for 15 minutes
const SIGNED_URL_EXPIRY_SECONDS = 60 * 15;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const productId: string | undefined = body?.product_id;

    if (!productId) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
    }

    const objectKey = PRODUCT_FILES[productId];
    if (!objectKey) {
      return NextResponse.json({ error: 'Unknown product' }, { status: 404 });
    }

    // ── 1. Verify purchase in Supabase ────────────────────────────────────────
    // Purchase records live in the `purchases` table, written by the Stripe webhook.
    // Table schema:
    //   purchases (id uuid, stripe_session_id text, product_id text,
    //              customer_email text, user_id uuid,
    //              created_at timestamptz, fulfilled_at timestamptz)
    //
    // Buyer identity is verified ONLY via the Supabase Auth JWT in the
    // Authorization header. The stripe_session_id fallback was removed: a
    // checkout session id is not a secret (it appears in the success URL,
    // history, and logs), so accepting it as proof of purchase was a bypass.

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error('Missing SUPABASE env vars');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Admin client — bypasses RLS
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const authHeader = request.headers.get('authorization') ?? '';

    let hasPurchase = false;

    if (authHeader.startsWith('Bearer ')) {
      // Verify Supabase JWT and look up by user_id
      const anonClient = createClient(
        supabaseUrl,
        anonKey,
        { auth: { persistSession: false } },
      );
      const { data: { user }, error: userErr } = await anonClient.auth.getUser(
        authHeader.slice(7),
      );

      if (!userErr && user) {
        const { data: purchase } = await adminClient
          .from('purchases')
          .select('id')
          .eq('product_id', productId)
          .eq('user_id', user.id)
          .maybeSingle();
        hasPurchase = !!purchase;
      }
    }

    if (!hasPurchase) {
      return NextResponse.json(
        { error: 'No purchase found for this product. Complete checkout to unlock the download.' },
        { status: 402 },
      );
    }

    // ── 2. Generate signed URL from Supabase Storage ──────────────────────────
    const { data: signedData, error: signedErr } = await adminClient.storage
      .from('paid-releases')
      .createSignedUrl(objectKey, SIGNED_URL_EXPIRY_SECONDS);

    if (signedErr || !signedData?.signedUrl) {
      console.error('Supabase signed URL error:', signedErr);
      return NextResponse.json({ error: 'Failed to generate download link' }, { status: 500 });
    }

    return NextResponse.json({
      url: signedData.signedUrl,
      filename: objectKey,
      expires_in: SIGNED_URL_EXPIRY_SECONDS,
    });
  } catch (err) {
    console.error('signed-url route error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
