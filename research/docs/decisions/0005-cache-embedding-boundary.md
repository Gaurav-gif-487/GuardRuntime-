# ADR 0005 — No fabricated semantic embeddings

**Status:** accepted · **Applies to:** PCR

The SDK does not ship a fake bag-of-words vector and call it semantic similarity. If an `EmbeddingProvider` is supplied, PCR performs cosine similarity inside the hard tenant/permission/resource/environment/schema scope. If none is supplied, PCR falls back to exact goal matching only. This keeps caching functional without pretending lexical hashing is an embedding model.
