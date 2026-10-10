# LiqIn

LiqIn is a self-hosted liquor inventory application. It provides a dashboard for
items such as whiskey, wine, gin, rum, and tequila, with user-defined groups,
custom fields, photos, thumbnails, filtering, and grid/list views.

## Features

- User registration, username/email login, logout, and password changes.
- Empty inventory for every new user and new installation.
- Groups with custom fields:
  - Text, barcode, year, integer number, decimal, currency, single-option, and multiple-option fields.
  - Barcode values support manual entry and camera scanning where the browser provides the Barcode Detection API.
  - Configurable decimal precision.
  - Currency values with selectable currencies and fixed two-decimal precision.
  - Dashboard visibility and drag-and-drop field ordering.
- Item management with quantities, custom values, photos, and generated thumbnails.
- Search, group tabs, stock/photo filters, sorting, and grid/list views.
- JSON-only backup export/import and ZIP backup export/import with item photos.
- PostgreSQL for application data.
- Local filesystem storage for uploaded originals and thumbnails.
- Docker Compose deployment for the application and PostgreSQL.

## Architecture

The production deployment contains two services:

- **app** — Node.js, TypeScript, Express API, and the static frontend.
- **db** — PostgreSQL.

PostgreSQL stores users, sessions, groups, field definitions, items, and image
metadata. Uploaded image files are stored in the persistent `liqin_uploads`
Docker volume. Images are converted to JPEG originals and thumbnails, and image
routes require authentication and ownership.

The application has two modes:

- **Production/HTTP mode** — the frontend uses the API and PostgreSQL.
- **Direct `file://` mode** — the frontend runs as a browser-local prototype
  using `localStorage` and `sessionStorage`.

## Production installation with Docker Compose

### Prerequisites

Install and start:

- Docker Desktop on Windows or macOS, or Docker Engine and Compose on Linux.
- Git.

Verify the installation:

```powershell
docker version
docker compose version
```

### 1. Download the application

```powershell
git clone https://github.com/adrielintan/LiqIn.git
Set-Location LiqIn
```

If the repository is already present:

```powershell
git pull
```

### 2. Create the environment file

Copy the example file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace `POSTGRES_PASSWORD` with a long, unique password.
Update the password in `DATABASE_URL` to the same value:

```text
POSTGRES_USER=liqin
POSTGRES_PASSWORD=replace-with-your-real-password
DATABASE_URL=postgresql://liqin:replace-with-your-real-password@db:5432/liqin
```

At minimum, review these settings:

| Variable | Purpose | Default |
|---|---|---|
| `APP_PORT` | Host port exposed for the web application | `3000` |
| `PORT` | Port used inside the app container | `3000` |
| `HTTPS_ENABLED` | Enables HTTPS-only browser security headers | `false` |
| `DB_PORT` | Host port exposed for PostgreSQL | `5432` |
| `POSTGRES_DB` | PostgreSQL database name | `liqin` |
| `POSTGRES_USER` | PostgreSQL username | `liqin` |
| `POSTGRES_PASSWORD` | PostgreSQL password | Must be changed |
| `DATABASE_URL` | App-to-database connection URL | Must match credentials |
| `SESSION_TTL_DAYS` | Session lifetime | `30` |
| `MAX_UPLOAD_BYTES` | Maximum image size | `10485760` |

Never commit `.env`. It is ignored by Git.

### 3. Validate and start the stack

Validate the expanded Compose configuration:

```powershell
docker compose config
```

Build and start in the background:

```powershell
docker compose up --build -d
```

Open the application at:

```text
http://localhost:3000
```

The exact URL uses the configured `APP_PORT`.

### 4. Verify the installation

Check the containers:

```powershell
docker compose ps
```

Check application health:

```powershell
curl.exe http://localhost:3000/health
curl.exe http://localhost:3000/ready
```

Expected responses:

```json
{"status":"ok","database":"ok"}
{"status":"ready"}
```

Register the first user through the web interface. The dashboard will be empty
until groups and items are added.

## Operating the deployment

View logs:

```powershell
docker compose logs -f app
docker compose logs -f db
```

Restart services:

```powershell
docker compose restart
```

Stop services without deleting data:

```powershell
docker compose down
```

Update to a newer version:

```powershell
git pull
docker compose up --build -d
```

Do not use `docker compose down -v` unless you intentionally want to delete the
database and upload volumes.

## Database migrations

For a new installation, numbered SQL files in [`db/`](./db/) run automatically
when PostgreSQL initializes a new data volume.

For an existing database volume, initialization scripts do not run again. Apply
new migrations explicitly before restarting the application. For example:

```powershell
Get-Content db/002_add_group_field_placeholder.sql |
  docker compose exec -T db psql -U $env:POSTGRES_USER -d $env:POSTGRES_DB
```

If the environment variables are not loaded into the current PowerShell session,
use the values from `.env` explicitly:

```powershell
Get-Content db/002_add_group_field_placeholder.sql |
  docker compose exec -T db psql -U liqin -d liqin
```

## Backups and data persistence

The deployment uses two persistent Docker volumes:

- `liqin_db` — PostgreSQL data.
- `liqin_uploads` — uploaded image files.

Back up both. A database backup without the upload volume will not preserve
images, and an upload backup without the database will not preserve their
metadata.

The application also provides JSON backup export/import in Settings. This
contains groups, items, field definitions, and values. Embedded images are
uploaded through the authenticated image API during import.

The **Clear inventory** action removes the current user's groups, items, custom
fields, image metadata, and uploaded image files. It does not delete the user
account or other users' data.

## HTTPS and production security

For an internet-facing deployment:

1. Put the app behind an HTTPS reverse proxy such as Caddy, Nginx, or Traefik.
2. Set `NODE_ENV=production` and `HTTPS_ENABLED=true` when HTTPS is terminated before the app.
3. Use a long random database password.
4. Restrict PostgreSQL access to the internal Docker network when possible.
5. Do not expose port `5432` publicly unless it is explicitly required.
6. Back up the database and upload volume regularly.
7. Store `.env` securely and restrict its filesystem permissions.

When accessing the container directly over HTTP, such as
`http://server-address:9345`, keep `HTTPS_ENABLED=false`. This prevents the
browser from upgrading asset requests to HTTPS before a TLS endpoint exists and
allows the HTTP session cookie to be stored. When HTTPS is enabled, the session
cookie is marked `Secure`.

Production OIDC is intentionally deferred. The authentication boundary is
isolated so an OIDC provider can be added later without changing inventory
workflows.

## Local prototype mode

For a dependency-free browser prototype, open [`index.html`](./index.html)
directly. This mode does not use Docker, PostgreSQL, or the API.

Local prototype data is stored in the browser:

- `localStorage` — inventory, groups, and local users.
- `sessionStorage` — the current local session.

Use the Settings backup tools to export or import prototype data. The prototype
also starts empty and its clear action leaves the inventory empty.

## Development commands

Install dependencies:

```powershell
npm install
```

Build the TypeScript API:

```powershell
npm run build
```

Start the compiled API:

```powershell
npm start
```

Run the development watcher:

```powershell
npm run dev
```

## Troubleshooting

### Docker cannot connect to the daemon

Start Docker Desktop or the Docker service, then verify:

```powershell
docker version
docker compose version
```

The client version alone is not sufficient; `docker version` must also show a
Server section.

### The app cannot connect to PostgreSQL

Check:

```powershell
docker compose ps
docker compose logs db
```

Confirm that `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB`, and the
credentials in `DATABASE_URL` match.

### The database schema is missing a column

This usually means the database volume existed before a migration was added.
Apply the relevant numbered SQL migration manually as described in
[Database migrations](#database-migrations).

### Port already in use

Change `APP_PORT` or `DB_PORT` in `.env`, then recreate the stack:

```powershell
docker compose up --build -d
```

### Images are missing

Check both the application logs and the upload volume:

```powershell
docker compose logs app
docker volume ls
```

Do not remove `liqin_uploads` if you need to preserve uploaded images.
