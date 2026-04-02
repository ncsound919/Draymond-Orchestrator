import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const module = searchParams.get('module');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') ?? '30');
    const offset = parseInt(searchParams.get('offset') ?? '0');

    let query = supabase
      .from('posts')
      .select(`
        *,
        author:profiles(id, username, display_name, avatar_url, role),
        reaction_count:post_reactions(count)
      `)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (module) {
      query = query.eq('module', module);
    }
    if (type) {
      query = query.eq('type', type);
    }

    const { data: posts, error } = await query;
    if (error) throw error;

    return NextResponse.json({ posts });
  } catch (err) {
    console.error('GET /api/posts error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch posts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, body: postBody, type, module, tags } = body;

    if (!postBody || !type) {
      return NextResponse.json(
        { error: 'body and type are required' },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
    const { data: post, error } = await (supabase as any)
      .from('posts')
      .insert({
        author_id: user.id,
        title: title ?? '',
        body: postBody,
        type,
        module: module ?? null,
        tags: tags ?? [],
        status: 'active',
      })
      .select(`
        *,
        author:profiles(id, username, display_name, avatar_url, role)
      `)
      .single();

    if (error) throw error;

    return NextResponse.json({ post }, { status: 201 });
  } catch (err) {
    console.error('POST /api/posts error:', err);
    return NextResponse.json(
      { error: 'Failed to create post' },
      { status: 500 }
    );
  }
}
