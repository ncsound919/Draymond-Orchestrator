'use client';

// ============================================================================
// Command Center — Science panel
// ============================================================================
// Research literature grounding: brain publish status banner, a Global Lens
// paper-publish form (may take 30–90s), and the cached papers registry grouped
// by goal. All reads go through the ccFetch server-action bridge.
// ============================================================================

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, FlaskConical, Loader2, Send, WifiOff } from 'lucide-react';

import { ccFetch } from '@/app/command-center/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  paperSourceLabel,
  paperYearLabel,
  papersByGoal,
  type PaperLike,
} from '../sites-lib';

interface PublishStatus {
  ok?: boolean;
  brainConfigured?: boolean;
  endpoint?: string;
}

interface PapersResponse {
  ok?: boolean;
  papers?: Record<string, PaperLike[]>;
}

interface PublishResponse {
  ok?: boolean;
  output?: string;
  error?: string;
}

function snippetOf(output: string | undefined, max = 180): string {
  const trimmed = (output ?? '').trim();
  if (!trimmed) return '';
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export default function SciencePanel() {
  const [topic, setTopic] = useState('');

  // ── Brain status banner ───────────────────────────────────────────────────
  const statusQuery = useQuery({
    queryKey: ['command-center', 'science', 'status'],
    queryFn: async () => {
      const res = await ccFetch<PublishStatus>({
        endpoint: '/api/command-center/science/publish',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load brain status');
      return res.data;
    },
  });

  // ── Publish form ──────────────────────────────────────────────────────────
  const publish = useMutation({
    mutationFn: async (value: string) => {
      const res = await ccFetch<PublishResponse>({
        endpoint: '/api/command-center/science/publish',
        method: 'POST',
        body: { topic: value },
      });
      if (!res.ok) {
        throw new Error(res.data?.error ?? res.error ?? 'Publish failed');
      }
      return res.data;
    },
    onSuccess: (data) => {
      const snippet = snippetOf(data?.output);
      if (snippet) toast.success(`Paper published — ${snippet}`);
      else toast.success('Paper published');
      setTopic('');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Publish failed');
    },
  });

  const handlePublish = () => {
    const trimmed = topic.trim();
    if (!trimmed) {
      toast.error('Topic is required');
      return;
    }
    publish.mutate(trimmed);
  };

  // ── Papers registry ───────────────────────────────────────────────────────
  const papersQuery = useQuery({
    queryKey: ['command-center', 'science', 'papers'],
    queryFn: async () => {
      const res = await ccFetch<PapersResponse>({
        endpoint: '/api/research/papers',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load papers');
      return res.data?.papers ?? {};
    },
  });

  const groups = papersByGoal(papersQuery.data);

  const brainConfigured = statusQuery.data?.brainConfigured;
  const brainLoading = statusQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* Brain status banner */}
      <Card className="border border-white/10 bg-white/5 text-white">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <FlaskConical className="size-4" />
                Deterministic Brain
              </CardTitle>
              <CardDescription className="text-white/40">
                Paper publishes are routed through the deterministic brain bridge.
              </CardDescription>
            </div>
            {brainLoading ? (
              <Skeleton className="h-6 w-40 bg-white/10" />
            ) : statusQuery.isError ? (
              <Badge variant="outline" className="border-white/10 text-white/40">
                Status unavailable
              </Badge>
            ) : brainConfigured ? (
              <Badge className="border-green-500/30 bg-green-500/10 text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-white/40">
            {brainConfigured
              ? 'The brain is reachable — Global Lens publishes will be processed.'
              : 'BRAIN_URL is not configured. Publishing will fail until the deterministic brain is reachable.'}
          </p>
        </CardContent>
      </Card>

      {/* Publish form */}
      <Card className="border border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle className="text-base text-white">Publish a paper</CardTitle>
          <CardDescription className="text-white/40">
            Ask the Global Lens to write and publish a research paper on a topic. This can take up to 90 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="flex-1 border-white/10 bg-white/5 text-white placeholder:text-white/30"
              placeholder="e.g. How do LLM agents decide when to invoke tools?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !publish.isPending) handlePublish();
              }}
              disabled={publish.isPending}
            />
            <Button
              className="bg-white text-black hover:bg-white/80"
              disabled={publish.isPending || !topic.trim()}
              onClick={handlePublish}
            >
              {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {publish.isPending ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
          {publish.isPending && (
            <p className="mt-2 text-xs text-white/40">
              Running the Global Lens pipeline — this may take up to 90 seconds. The button stays disabled until it finishes.
            </p>
          )}
        </CardContent>
      </Card>

      <Separator className="bg-white/10" />

      {/* Papers registry */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Published papers</h2>
          <span className="text-xs text-white/40">
            {papersQuery.data && Object.keys(papersQuery.data).length > 0
              ? `${Object.values(papersQuery.data).reduce((n, p) => n + (Array.isArray(p) ? p.length : 0), 0)} papers`
              : 'Cached from OpenAlex + PubMed'}
          </span>
        </div>

        {papersQuery.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full bg-white/10" />
            ))}
          </div>
        ) : papersQuery.isError ? (
          <OfflineState
            message={papersQuery.error instanceof Error ? papersQuery.error.message : 'Failed to load papers'}
            onRetry={() => papersQuery.refetch()}
          />
        ) : groups.length === 0 ? (
          <Card className="border border-white/10 bg-white/5 text-white">
            <CardContent className="py-8">
              <p className="text-center text-sm text-white/40">
                No papers cached yet. Publish a paper above or run the paper refresh pipeline to populate this registry.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {groups.map(({ goal, papers }) => (
              <div key={goal} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">{goal}</h3>
                <div className="space-y-2">
                  {papers.map((p) => (
                    <Card key={p.id ?? `${goal}-${p.title}`} className="border border-white/10 bg-white/5 text-white">
                      <CardContent className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <a
                              href={p.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="line-clamp-2 text-sm font-medium text-white hover:text-white/70"
                            >
                              {p.title || 'Untitled'}
                            </a>
                            <p className="mt-1 text-xs text-white/40">
                              {paperYearLabel(p.year)}
                              {p.authors ? ` · ${p.authors}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className="border-white/10 text-white/60">
                              {paperSourceLabel(p.source)}
                            </Badge>
                            {p.url && (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open paper: ${p.title ?? ''}`}
                                className="text-white/40 hover:text-white"
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OfflineState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 py-8 text-center">
      <WifiOff className="size-6 text-white/40" />
      <div>
        <p className="text-sm font-medium text-white">Could not reach the bridge</p>
        <p className="mt-1 max-w-sm text-xs text-white/40">{message}</p>
      </div>
      <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
