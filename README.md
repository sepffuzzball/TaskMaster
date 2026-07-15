# TaskMaster

A full-stack project management tool with AI breakdown capabilities.

## Local Development

### Prerequisites

- Node.js >= 22
- npm (works with workspaces)

### Setup

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Fill in your values in `.env`. At minimum you need:

- `APP_ORIGIN` (e.g. `http://localhost:3000`)
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` for OIDC authentication
- `DB_DIALECT` (`sqlite` or `postgres`; defaults to `sqlite`)

For OIDC, you also need to configure your provider. See [OIDC Configuration](#oidc-configuration) below.

3. Install dependencies:

```bash
npm install
```

4. Run database migrations:

```bash
npm run db:migrate
```

5. Start development (API and Vite concurrently):

```bash
npm run dev
```

The API runs on `http://localhost:3000` and the Vite dev server on `http://localhost:5173`.

### Production Build

```bash
npm run build
```

This compiles the API TypeScript, the web app TypeScript, and runs Vite production build. Outputs:

- `apps/api/dist/` - compiled API server code
- `apps/web/dist/` - compiled Vite SPA assets and TypeScript output

To start the production API:

```bash
npm run start
```

The production server serves static assets from `apps/web/dist/` with SPA fallback for non-API/MCP/docs routes.

## Docker

### Build

```bash
docker build -t taskmaster:latest .
```

### Run with SQLite (default)

```bash
docker run -p 3000:3000 \
  -e APP_ORIGIN=http://localhost:3000 \
  -e OIDC_ISSUER=https://... \
  -e OIDC_CLIENT_ID=... \
  -e OIDC_CLIENT_SECRET=... \
  -e OIDC_REDIRECT_URI=http://localhost:3000/api/v1/auth/callback \
  -v taskmaster_data:/data \
  taskmaster:latest
```

The SQLite database is stored at `/data/taskmaster.db` inside the container; the `/data` volume persists it.

### Run with PostgreSQL

Set `DB_DIALECT=postgres` and `DATABASE_URL` (see [Postgres Configuration](#postgres-configuration) below).

### Docker Compose

```bash
docker compose up -d
```

This uses SQLite by default with a persistent volume `taskmaster_data`. To use PostgreSQL, uncomment the postgres service and set `DATABASE_URL`.

## GitHub Container Registry (GHCR)

This project publishes a Docker image to GitHub Container Registry. The workflow uses pinned major action versions and push-on-branch/tag triggers.

To pull the latest image:

```bash
docker pull ghcr.io/<your-username>/taskmaster:latest
```

## OIDC Configuration

TaskMaster uses OIDC for authentication. You need:

1. An OIDC-compatible provider (e.g., Auth0, Google, Microsoft, or a local Keycloak instance).
2. Configure the provider with:
   - Issuer URL (e.g., `https://auth.example.com`)
   - Client ID
   - Client Secret
   - Redirect URI (set to `http://localhost:3000/api/v1/auth/callback` in dev, or your production URL)

Then set the corresponding env vars in `.env` or Docker environment.

## Database Configuration

### SQLite

SQLite is the default. The database path is controlled by `SQLITE_PATH`. Defaults to `/data/taskmaster.db` (Docker) or `/tmp/taskmaster.db` (local).

```bash
# .env (local)
DB_DIALECT=sqlite
SQLITE_PATH=/tmp/taskmaster.db
```

### PostgreSQL

For PostgreSQL, set:

```bash
# .env (local)
DB_DIALECT=postgres
DATABASE_URL=postgresql://username:password@host:5432/dbname
```

In Docker, you can run a separate postgres container and connect via `DATABASE_URL`.

## API Documentation

API docs are available via Swagger UI at `/docs`. In development, navigate to `http://localhost:3000/docs`. In production, the docs route is accessible.

### MCP (Model Context Protocol)

TaskMaster exposes an MCP endpoint at `/mcp`. For details, see the MCP route source or AI integration documentation.

## OpenAI-Compatible Configuration

The AI breakdown feature uses OpenAI-compatible APIs. Configure via:

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

You may use any OpenAI-compatible provider (e.g., Azure, local Ollama, etc.) by setting `OPENAI_BASE_URL` appropriately.

## Themes

The web app supports theme customization via CSS variables. Edit `apps/web/src/styles.css` or use the Settings dialog in the UI.

## License

[License information here.]
