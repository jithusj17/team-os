import { z } from 'zod';
import type { Config } from '../../../config.js';
import { EMBEDDING_DIMENSIONS } from '../../../infrastructure/db/schema.js';
import type { EmbeddingProvider } from '../domain/ports.js';

/** No provider configured: indexing stores text only and search is keyword-only. */
export class NoEmbeddings implements EmbeddingProvider {
  readonly enabled = false;
  readonly minSimilarity = 1;
  async embed(): Promise<number[][]> {
    throw new Error('Embeddings are not configured');
  }
}

const voyageResponse = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number() })),
});

/** Voyage AI embeddings (https://docs.voyageai.com). Query embeddings are cached briefly. */
export class VoyageEmbeddings implements EmbeddingProvider {
  readonly enabled = true;
  // Voyage similarities for unrelated text sit well below this; related text is usually above.
  readonly minSimilarity = 0.3;
  private readonly queryCache = new Map<string, number[]>();

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    if (kind === 'query' && texts.length === 1 && this.queryCache.has(texts[0]!)) {
      return [this.queryCache.get(texts[0]!)!];
    }
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      out.push(...(await this.request(texts.slice(i, i + 64), kind)));
    }
    if (kind === 'query' && texts.length === 1) {
      if (this.queryCache.size > 500) this.queryCache.delete(this.queryCache.keys().next().value!);
      this.queryCache.set(texts[0]!, out[0]!);
    }
    return out;
  }

  private async request(input: string[], kind: 'document' | 'query'): Promise<number[][]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        input,
        model: this.model,
        input_type: kind,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok)
      throw new Error(
        `Voyage embeddings failed: ${res.status} ${await res.text().catch(() => '')}`,
      );
    const { data } = voyageResponse.parse(await res.json());
    return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export function embeddingsFromConfig(config: Config): EmbeddingProvider {
  return config.EMBEDDINGS_PROVIDER === 'voyage' && config.VOYAGE_API_KEY
    ? new VoyageEmbeddings(config.VOYAGE_API_KEY, config.EMBEDDINGS_MODEL)
    : new NoEmbeddings();
}
