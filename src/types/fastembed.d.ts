/**
 * Ambient declaration for the OPTIONAL `fastembed` dependency.
 *
 * fastembed is deliberately absent from the install tree (ADR-017): it pulls a `tar` chain with
 * nine advisories, one critical, for a promote-time de-duplication nicety most installs never use.
 * Consumers who want semantic de-dup install it themselves.
 *
 * `FastEmbedGateway` reaches it through `await import('fastembed')`, so the module may or may not
 * exist at typecheck time. This declaration makes the typecheck deterministic either way — which
 * `@ts-expect-error` would not: that would itself error as unused whenever the package IS present.
 *
 * The shape is intentionally minimal: only what the gateway touches. It is not a vendored copy of
 * fastembed's types, and it MUST NOT grow into one — if the gateway needs more of the API, that is
 * the signal to make fastembed a real dependency and delete this file.
 */
declare module 'fastembed' {
  export enum EmbeddingModel {
    BGESmallEN = 'fast-bge-small-en',
    BGESmallENV15 = 'fast-bge-small-en-v15',
  }

  export class FlagEmbedding {
    static init(options?: {
      model?: EmbeddingModel;
      cacheDir?: string;
      maxLength?: number;
      showDownloadProgress?: boolean;
    }): Promise<FlagEmbedding>;

    embed(texts: string[], batchSize?: number): AsyncGenerator<number[][]>;
    queryEmbed(text: string): Promise<number[]>;
  }
}
