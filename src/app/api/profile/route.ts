import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) throw error;

    return NextResponse.json({ profile });
  } catch (err) {
    console.error('GET /api/profile error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      display_name,
      bio,
      location,
      avatar_url,
      skills,
      interests,
      social_links,
    } = body;

    // Prevent username changes via this endpoint
    const updateData: Record<string, unknown> = {};
    if (display_name !== undefined) updateData.display_name = display_name;
    if (bio !== undefined) updateData.bio = bio;
    if (location !== undefined) updateData.location = location;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;
    if (skills !== undefined) updateData.skills = skills;
    if (interests !== undefined) updateData.interests = interests;
    if (social_links !== undefined) updateData.social_links = social_links;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
    const { data: profile, error } = await (supabase as any)
      .from('profiles')
      .update(updateData)
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ profile });
  } catch (err) {
    console.error('PATCH /api/profile error:', err);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
