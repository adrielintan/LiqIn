"# LiqIn" 

A lightweight liquor inventory dashboard prototype.

## Run locally

Open [index.html](./index.html) in a browser. No build step or package installation is required.

## Included in this first slice

- Responsive dashboard with a bottle grid, search, group tabs, summary cards, and collection value.
- Add-item modal with group-specific fields for whiskey, wine, gin, rum, and tequila.
- Client-side image selection with a thumbnail preview before the item is added.
- Browser-local persistence for items and custom groups, so prototype data survives refreshes.
- New installations start with an empty dashboard; the Settings clear action removes all inventory data instead of restoring sample data.
- A group builder supporting custom field types including text, year, date, currency, integer, decimal, single option, and multiple options."
- Group management with edit, rename, and safe deletion for empty groups.
- Group creation is opened separately from the group manager using the Add Group action below the group list.
- Structured option chips replace comma-separated option entry; multiple-option fields render as selectable checkbox groups.
- Photo selection resets between item forms and revokes temporary preview URLs to avoid showing a previous upload."
- The field builder's Add field action stays below the current field list, and previews use generated data URLs for reliable display."
- Dashboard filters support group, stock level, photo availability, and sorting.
- Inventory cards can switch between responsive grid and compact list views."
- Numeric field types omit whole number fields, support configurable decimal precision, and hide browser number steppers.
- Currency fields always use two decimal places and let each item select a currency such as USD, EUR, or IDR."
- Group fields are hidden from dashboard cards by default and can be enabled individually; enabled values appear in the configured field order.
- Field order can be changed by dragging fields in the group builder.
- Item details with custom field values, edit/delete actions, and browser-generated image thumbnails."
- JSON backup and restore controls in Settings for moving prototype data between browsers."
- Local registration and login gate the dashboard; passwords are stored only as Web Crypto hashes and sessions use session storage.
- Registration uses a username and email address; sign-in accepts either the username or email address.
- Signed-in users can change their password from Settings by confirming their current password and the new password.
- Production foundation includes a TypeScript API, PostgreSQL schema, Docker Compose services, and a persistent filesystem upload volume.

## Production self-hosting

The production foundation uses Node.js, TypeScript, PostgreSQL, Docker Compose, and the local server filesystem for uploaded originals and thumbnails. Copy `.env.example` to `.env` and set at least `POSTGRES_PASSWORD` before starting:

```text
copy .env.example .env
docker compose up --build
```

Configuration is supplied through `.env`, including the application port (`APP_PORT`), API port (`PORT`), PostgreSQL port (`DB_PORT`), database credentials, upload directory, session settings, and maximum upload size. Never commit `.env`.

PostgreSQL stores users, sessions, groups, field definitions, items, and image metadata. The image files live in the `liqin_uploads` Docker volume and are referenced by paths in `item_images`. Uploaded images are converted to JPEG originals and 480px thumbnails, then served only to the owning authenticated user.

The database initialization script runs only when the PostgreSQL volume is created. Back up both the database volume and the upload volume. New database volumes contain no sample groups or items.

The container-served UI uses the API for authentication, group and item CRUD, image upload, and JSON backup import. Opening `index.html` directly with `file://` continues to use the browser-local prototype fallback. An API import replaces the signed-in user's groups and items, then sends embedded images through the normal filesystem upload pipeline. API JSON requests are limited to 25 MB; individual images follow `MAX_UPLOAD_BYTES`.
- Authentication is isolated so a future OIDC provider can replace the local provider without changing inventory workflows.

The current schema assigns groups to users. For an existing development database created by an earlier scaffold, use a database migration before starting the updated API; a newly created PostgreSQL volume applies the current schema automatically.

For an existing Compose database volume, apply pending migrations before restarting the app, for example:

```powershell
Get-Content db/002_add_group_field_placeholder.sql | docker compose exec -T db psql -U $env:POSTGRES_USER -d $env:POSTGRES_DB
```

For a new production installation, the numbered SQL files in `db/` run automatically during PostgreSQL initialization.
