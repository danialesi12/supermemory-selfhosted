# supermemory (self-hosted) — OpenRouter fork

A self-hosted, API-compatible reimplementation of [Supermemory](https://supermemory.ai) — a memory layer for AI applications. Store documents, embed them automatically, and search by semantic similarity. Runs entirely in Docker.

> **Fork di [s11ngh/supermemory-selfhosted](https://github.com/s11ngh/supermemory-selfhosted)**  
> Modificato per usare **OpenRouter** come provider di embedding al posto di Novita AI.

## Modifiche rispetto all'originale

| Cosa | Originale | Questo fork |
|------|-----------|-------------|
| Provider embedding | Novita AI | OpenRouter |
| Modello | `qwen/qwen3-embedding-8b` | `mistralai/mistral-embed` |
| Dimensioni vettore | 1536 | 1024 |
| Variabile d'ambiente | `NOVITA_API_KEY` | `OPENROUTER_API_KEY` |

> ⚠️ Se migri dalla versione originale devi droppare e ricreare la tabella `documents` perché le dimensioni dell'embedding sono cambiate:
> ```bash
> docker exec -it db-<id> psql -U supermemory -c "DROP TABLE IF EXISTS documents CASCADE;"
> ```
> Le migrazioni ricrееranno la tabella automaticamente al riavvio.

## Why self-host?

Supermemory is a great product, but the backend is closed-source. The [public repo](https://github.com/supermemoryai/supermemory) only ships the frontend and client SDKs, and their official self-hosting option is enterprise-only (Cloudflare Workers).

This project reimplements the `/v3` and `/v4` API endpoints from scratch, reverse-engineered from the [TypeScript SDK](https://github.com/supermemoryai/sdk-ts) contract. Existing clients — including the official `supermemory` npm package — can point at your instance with no code changes.

## Stack

| Component | Role |
|-----------|------|
| [Hono](https://hono.dev) | HTTP framework (Node.js) |
| [Postgres 17](https://www.postgresql.org/) + [pgvector](https://github.com/pgvector/pgvector) | Document storage and vector search |
| [OpenRouter](https://openrouter.ai) | Embedding generation (`mistralai/mistral-embed`) |

## Getting started

### Prerequisites

- Docker and Docker Compose
- Un account [OpenRouter](https://openrouter.ai) con API key

### 1. Clone and configure

```bash
git clone https://github.com/TUO_USERNAME/supermemory-selfhosted.git
cd supermemory-selfhosted
cp .env.example .env
```

Edit `.env` with your keys:

```env
OPENROUTER_API_KEY=sk-or-XXXXX       # OpenRouter API key
SUPERMEMORY_API_KEY=                  # Optional: require Bearer token auth
```

### 2. Start (senza Tailscale, con Traefik/Coolify)

```yaml
services:
  supermemory-api:
    build: .
    depends_on:
      db:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://supermemory:supermemory@db:5432/supermemory
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - SUPERMEMORY_API_KEY=${SUPERMEMORY_API_KEY}
      - PORT=8787
    restart: unless-stopped
    labels:
      - traefik.enable=true
      - traefik.http.routers.supermemory.rule=Host(`supermemory.tuodominio.it`)
      - traefik.http.routers.supermemory.entrypoints=https
      - traefik.http.services.supermemory.loadbalancer.server.port=8787
    networks:
      - coolify
      - internal
  db:
    image: pgvector/pgvector:pg17
    environment:
      - POSTGRES_USER=supermemory
      - POSTGRES_PASSWORD=supermemory
      - POSTGRES_DB=supermemory
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U supermemory"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - internal
networks:
  coolify:
    external: true
  internal:
    internal: true
volumes:
  pgdata:
```

### 3. Verify

```bash
curl https://<YOUR_DOMAIN>/health
# → {"status":"ok","version":"1.0.0"}
```

---

## Usage

### Store a document

```bash
curl -X POST https://<API_URL>/v3/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPERMEMORY_API_KEY>" \
  -d '{"content": "The project uses Postgres with pgvector for embeddings"}'
```

### Search by meaning

```bash
curl -X POST https://<API_URL>/v3/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPERMEMORY_API_KEY>" \
  -d '{"q": "what database do we use?", "limit": 5}'
```

### Use the official Supermemory SDK

```typescript
import Supermemory from "supermemory";

const client = new Supermemory({
  apiKey: "your-SUPERMEMORY_API_KEY",
  baseURL: "https://supermemory.tuodominio.it",
});

await client.add({ content: "Remember this." });
const results = await client.search.documents({ q: "what should I remember?" });
```

---

## API reference

All endpoints match the supermemory SDK contract. If `SUPERMEMORY_API_KEY` is set, all `/v3/*` and `/v4/*` routes require `Authorization: Bearer <key>`. The `/health` endpoint is always open.

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v3/documents` | Add a document (auto-embeds) |
| `POST` | `/v3/documents/batch` | Batch add documents |
| `POST` | `/v3/documents/list` | List documents (paginated) |
| `GET` | `/v3/documents/:id` | Get a document by ID |
| `PATCH` | `/v3/documents/:id` | Update content (re-embeds) or metadata |
| `DELETE` | `/v3/documents/:id` | Delete a document |
| `DELETE` | `/v3/documents/bulk` | Bulk delete by IDs |
| `POST` | `/v3/documents/file` | Upload and embed a file |
| `GET` | `/v3/documents/processing` | List documents still processing |

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v3/search` | Semantic search (v3 response shape) |
| `POST` | `/v4/search` | Semantic search (v4 response shape) |

### Memories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `DELETE` | `/v4/memories` | Delete by IDs or container tag |
| `PATCH` | `/v4/memories` | Update content or metadata |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v3/settings` | Get all settings |
| `PATCH` | `/v3/settings` | Merge new settings |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `POST` | `/v4/profile` | Profile endpoint |

---

## Swapping the embedding provider

Embedding logic lives in `src/embeddings.ts`. To use a different OpenAI-compatible provider, change model, dimensions, API key env var, and baseURL.

If you change the dimension count, drop and recreate the `documents` table since pgvector dimensions are fixed per column.

---

## Project structure