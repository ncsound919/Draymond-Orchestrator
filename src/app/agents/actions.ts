'use server';

import { getEntity, recordInvocation } from '@/lib/draymond/registry';
import { invokeEntity } from '@/lib/draymond/invoker';
import type { EntityForInvocation } from '@/lib/draymond/invoker';
import { initiateRecovery } from '@/lib/draymond/index';
import { requireDraymondActionAuth } from '@/lib/draymond/auth';
import { updateAgentAvatar } from '@/lib/registry/agent-store';
import fs from 'fs/promises';
import path from 'node:path';

/** Max avatar size (4 MB) and allowed mime types. */
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AVATAR_DIR = path.join(process.cwd(), 'public', 'avatars');

/**
 * Upload / replace the photo for an agent. Writes the image to
 * public/avatars/<slug>.png and updates the registry avatarUrl.
 */
export async function uploadAgentAvatar(formData: FormData): Promise<{ ok: boolean; avatarUrl?: string; error?: string }> {
  await requireDraymondActionAuth();

  const slugRaw = formData.get('slug');
  const file = formData.get('file');
  if (typeof slugRaw !== 'string' || !slugRaw) {
    return { ok: false, error: 'Missing agent slug' };
  }
  if (!file || !(file instanceof File)) {
    return { ok: false, error: 'Missing image file' };
  }

  // Sanitize slug to a safe filename (alphanumeric + dashes)
  const slug = slugRaw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug) {
    return { ok: false, error: 'Invalid agent slug' };
  }

  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    return { ok: false, error: 'Photo must be PNG, JPEG, or WebP' };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: 'Photo must be 4 MB or smaller' };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const avatarUrl = `/avatars/${slug}.${ext}`;

  try {
    await fs.mkdir(AVATAR_DIR, { recursive: true });
    await fs.writeFile(path.join(AVATAR_DIR, `${slug}.${ext}`), buf);
    await updateAgentAvatar(slug, avatarUrl);
    return { ok: true, avatarUrl };
  } catch (err) {
    console.error('[uploadAgentAvatar] failed:', err);
    return { ok: false, error: 'Failed to save photo' };
  }
}

/**
 * Server action �?" invoke an entity from the QuickActions panel.
 * Runs server-side so CRON_SECRET is never exposed to the browser.
 */
export async function invokeAgent(entityId: string): Promise<{ ok: boolean; message: string }> {
  await requireDraymondActionAuth();

  if (!entityId || typeof entityId !== 'string') {
    return { ok: false, message: 'Invalid entity ID' };
  }

  try {
    const entity = await getEntity(entityId);
    if (!entity) {
      return { ok: false, message: `Entity "${entityId}" not found` };
    }

    const entityMinimal: EntityForInvocation = {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      kind: entity.kind,
      invocation_method: entity.invocation_method,
      invocation_config: (entity.invocation_config as Record<string, unknown>) ?? {},
      timeout_seconds: entity.timeout_seconds,
    };

    await invokeEntity(entityMinimal, 'invoke', {}, {});

    // Record invocation (non-fatal)
    try {
      await recordInvocation(entity.id);
    } catch (recordErr) {
      console.error(
        '[invokeAgent] Failed to record invocation:',
        recordErr instanceof Error ? recordErr.message : recordErr,
      );
    }

    return { ok: true, message: 'Invoked successfully' };
  } catch (err) {
    console.error('[invokeAgent]', err instanceof Error ? err.message : err);
    return { ok: false, message: 'Invocation failed' };
  }
}

/**
 * Server action �?" trigger recovery for an entity from the QuickActions panel.
 */
export async function recoverAgent(entityId: string): Promise<{ ok: boolean; message: string }> {
  await requireDraymondActionAuth();

  if (!entityId || typeof entityId !== 'string') {
    return { ok: false, message: 'Invalid entity ID' };
  }

  try {
    await initiateRecovery(entityId);
    return { ok: true, message: 'Recovery initiated' };
  } catch (err) {
    console.error('[recoverAgent]', err instanceof Error ? err.message : err);
    return { ok: false, message: 'Recovery failed' };
  }
}
