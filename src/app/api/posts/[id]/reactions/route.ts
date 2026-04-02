import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: postId } = await params;
    const body = await request.json();
    const reactionType: string = body.type;

    if (!reactionType || !['uplift', 'can_help', 'solidarity'].includes(reactionType)) {
      return NextResponse.json(
        { error: 'Valid reaction type required: uplift | can_help | solidarity' },
        { status: 400 }
      );
    }

    // Upsert: one reaction per user per post
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
    const { data: reaction, error } = await (supabase as any)
      .from('post_reactions')
      .upsert(
        { post_id: postId, user_id: user.id, reaction_type: reactionType },
        { onConflict: 'post_id,user_id' }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ reaction }, { status: 201 });
  } catch (err) {
    console.error('POST /api/posts/[id]/reactions error:', err);
    return NextResponse.json(
      { error: 'Failed to add reaction' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: postId } = await params;

    const { error } = await supabase
      .from('post_reactions')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/posts/[id]/reactions error:', err);
    return NextResponse.json(
      { error: 'Failed to remove reaction' },
      { status: 500 }
    );
  }
}
