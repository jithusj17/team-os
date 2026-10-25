import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiDraftProposal, type AiDraftProposal } from '@team-os/shared';
import type { Config } from '../../../config.js';
import { unavailable, unprocessable } from '../../../shared/domain/errors.js';
import type { LanguageModel, ModelRequest } from '../domain/ports.js';

const declined = () =>
  unprocessable('ai_declined', 'The AI declined this request. Try rephrasing it.');

/** Maps SDK failures to domain errors the HTTP layer knows how to report. */
function translate(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return unavailable('ai_busy', 'The AI service is busy. Try again in a moment.');
  }
  if (err instanceof Anthropic.APIError) {
    return unavailable('ai_unavailable', 'The AI service is unavailable. Try again shortly.');
  }
  return err;
}

/**
 * Claude via the Anthropic SDK. Requests opt into server-side refusal fallbacks ("default"
 * routes a declined request to the model's default fallback; models without fallbacks
 * simply run alone).
 */
export class AnthropicLanguageModel implements LanguageModel {
  readonly enabled = true;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly name: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async *streamText(request: ModelRequest): AsyncIterable<string> {
    try {
      yield* this.stream(request);
    } catch (err) {
      throw translate(err);
    }
  }

  async draftActions(request: ModelRequest): Promise<AiDraftProposal> {
    try {
      return await this.draft(request);
    } catch (err) {
      throw translate(err);
    }
  }

  private async *stream({ system, prompt, signal }: ModelRequest): AsyncIterable<string> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.name,
        max_tokens: 4096,
        // Summaries and answers are short and latency-sensitive (first token < 2 s).
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw declined();
  }

  private async draft({ system, prompt, signal }: ModelRequest): Promise<AiDraftProposal> {
    const message = await this.client.beta.messages.parse(
      {
        model: this.name,
        max_tokens: 8000,
        output_config: { effort: 'medium', format: betaZodOutputFormat(aiDraftProposal) },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    );
    if (message.stop_reason === 'refusal') throw declined();
    if (!message.parsed_output) throw new Error(`No structured output (${message.stop_reason})`);
    return message.parsed_output;
  }
}

/** Used when no API key is configured; use cases check `enabled` before calling it. */
export class DisabledLanguageModel implements LanguageModel {
  readonly enabled = false;
  readonly name = 'none';

  // eslint-disable-next-line require-yield -- never yields: AI is off
  async *streamText(): AsyncIterable<string> {
    throw new Error('AI is not configured');
  }

  async draftActions(): Promise<AiDraftProposal> {
    throw new Error('AI is not configured');
  }
}

export function languageModelFromConfig(config: Config): LanguageModel {
  return config.ANTHROPIC_API_KEY
    ? new AnthropicLanguageModel(config.ANTHROPIC_API_KEY, config.AI_MODEL)
    : new DisabledLanguageModel();
}
