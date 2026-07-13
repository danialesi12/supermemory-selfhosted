import { Hono } from "hono";
import { query } from "../db.js";
import { generateEmbedding } from "../embeddings.js";
import pgvector from "pgvector";

const search = new Hono();

search.post("/", async (c) => {
  const body = await c.req.json();
  const { q, containerTag, limit = 10, threshold = 0.1, mode = "hybrid" } = body;

  if (!q) {
    return c.json({ error: "q (query) is required" }, 400);
  }

  const embedding = await generateEmbedding(q);
  const embeddingSql = pgvector.toSql(embedding);

  const containerFilter = containerTag ? `AND container_tag = '${containerTag}'` : "";

  let rows: any[] = [];

  if (mode === "semantic") {
    const result = await query(`
      SELECT id, content, metadata, container_tag, status, created_at, updated_at,
        1 - (embedding <=> $1::vector) AS score
      FROM documents
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> $1::vector) > $2
        ${containerFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `, [embeddingSql, threshold, limit]);
    rows = result.rows;

  } else if (mode === "fulltext") {
    const result = await query(`
      SELECT id, content, metadata, container_tag, status, created_at, updated_at,
        ts_rank(fts, plainto_tsquery('simple', $1)) AS score
      FROM documents
      WHERE fts @@ plainto_tsquery('simple', $1)
        ${containerFilter}
      ORDER BY score DESC
      LIMIT $2
    `, [q, limit]);
    rows = result.rows;

  } else {
    // Hybrid: RRF fusion
    const k = 60;

    const [vectorResult, ftsResult] = await Promise.all([
      query(`
        SELECT id, content, metadata, container_tag, status, created_at, updated_at,
          1 - (embedding <=> $1::vector) AS score
        FROM documents
        WHERE embedding IS NOT NULL
          ${containerFilter}
        ORDER BY embedding <=> $1::vector
        LIMIT 20
      `, [embeddingSql]),
      query(`
        SELECT id, content, metadata, container_tag, status, created_at, updated_at,
          ts_rank(fts, plainto_tsquery('simple', $1)) AS score
        FROM documents
        WHERE fts @@ plainto_tsquery('simple', $1)
          ${containerFilter}
        ORDER BY score DESC
        LIMIT 20
      `, [q])
    ]);

    // Mappa id -> dati documento
    const docMap = new Map<string, any>();
    [...vectorResult.rows, ...ftsResult.rows].forEach(row => {
      if (!docMap.has(row.id)) docMap.set(row.id, row);
    });

    // RRF scoring
    const rrfScores = new Map<string, number>();

    vectorResult.rows.forEach((row, rank) => {
      const prev = rrfScores.get(row.id) || 0;
      rrfScores.set(row.id, prev + 1 / (k + rank + 1));
    });

    ftsResult.rows.forEach((row, rank) => {
      const prev = rrfScores.get(row.id) || 0;
      rrfScores.set(row.id, prev + 1 / (k + rank + 1));
    });

    rows = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ ...docMap.get(id), score }));
  }

  return c.json({
    results: rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      containerTag: row.container_tag,
      score: parseFloat(row.score),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    count: rows.length,
  });
});

const searchV4 = new Hono();

searchV4.post("/", async (c) => {
  const body = await c.req.json();
  const { q, limit = 10 } = body;

  if (!q) {
    return c.json({ error: "q (query) is required" }, 400);
  }

  const embedding = await generateEmbedding(q);
  const embeddingSql = pgvector.toSql(embedding);

  const result = await query(`
    SELECT id, content, metadata, container_tag, created_at,
      1 - (embedding <=> $1::vector) AS score
    FROM documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `, [embeddingSql, limit]);

  return c.json({
    memories: result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      score: parseFloat(row.score),
      createdAt: row.created_at,
    })),
  });
});

export { search, searchV4 };