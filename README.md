# DocuKaksh

A lightweight, self-hosted document manager. Documents are organised by **person** (or category, such as "Papa", "Office" or "Car"). Each person has their own **nested folders**, and folders can hold files and more folders.

- Upload by button or drag and drop, with a progress bar
- Browse, preview (images, PDF, text), download, rename, move, delete
- Nested folders to any depth
- Search file names across every person
- Accounts with roles: a super admin manages users, every user manages their own documents
- Works on phones and tablets (drawer navigation, bottom sheets, full-screen preview)
- SQLite and plain files, no external services, about 20 MB of RAM when idle

## Run with Docker (recommended)

```bash
docker compose up -d --build
```

Open http://localhost:3000. On first visit, create the account. That account becomes the **super admin**. Setup is only available until the first account exists.

### Where your data is stored

All app data is in the folder `docukaksh-data/` next to `docker-compose.yml`. This is a bind mount, so it is a normal folder on the host.

```
docukaksh-data/
  docukaksh.db      database: accounts, persons, folders, file records
  uploads/          the uploaded files, stored under random names
```

Restarts, container rebuilds and image upgrades keep this folder intact.

**To move the app to another machine:** stop it, copy the whole `docukaksh-data` folder and `docker-compose.yml` to the new machine, then run `docker compose up -d --build`.

**To back up:** stop the app and copy the folder, or copy it while running. The database uses SQLite WAL mode, so stopping the app first is the safest option.

On Linux, the container runs as user `node` (uid 1000). If it cannot write to the folder, run `sudo chown -R 1000:1000 docukaksh-data`.

### Settings

| Variable        | Default | Purpose                                                              |
|-----------------|---------|----------------------------------------------------------------------|
| `DATA_DIR`      | `/data` | Where the database and uploads are stored inside the container       |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS, so the session cookie is HTTPS-only |
| `MAX_UPLOAD_MB` | `100`   | Largest accepted single file                                         |
| `PORT`          | `3000`  | HTTP port inside the container                                       |

### HTTPS

Put a reverse proxy in front (Caddy, Nginx Proxy Manager, Traefik), then set `COOKIE_SECURE: "true"`.

## Roles and users

| Role          | Manage own persons, folders and files | Create, disable, reset and delete users |
|---------------|:-------------------------------------:|:---------------------------------------:|
| `super_admin` | yes                                   | yes                                     |
| `user`        | yes                                   | no                                      |

- Each account sees only its own documents. Being a super admin does not give access to other accounts' files.
- The super admin creates accounts from **Admin → Users** and sets a temporary password. Users can change their password from the account menu.
- Disabling an account signs it out immediately. Resetting a password signs out that account's other sessions.
- The install always keeps at least one active super admin, and nobody can remove their own admin access or delete their own account.
- Deleting an account also deletes everything it owns, including the stored files. The confirmation dialog says so.

Permissions are defined in one place, `src/permissions.js`. Add a permission there and check it in a route with `requirePermission(...)`.

## Run without Docker

Requires Node.js 22.13 or later (Node 24 recommended).

```bash
npm install
npm start          # http://localhost:3000, data in ./data
npm test           # 17 API and RBAC tests
```

## Upgrading from an earlier version

Databases created before roles existed are upgraded automatically at startup. Existing accounts and files are kept. The earliest account becomes the super admin.

## Layout

```
src/
  server.js       entry point (reads env, starts HTTP, handles shutdown)
  app.js          Express app, security headers, static files
  routes.js       REST API: auth, account, users, persons, folders, files, search
  auth.js         scrypt password hashing, session tokens
  permissions.js  roles and permissions
  db.js           SQLite schema and upgrade steps (node:sqlite, no native build)
public/
  index.html, styles.css, app.js   the UI (no build step)
test/
  api.test.js     documents API
  rbac.test.js    roles, accounts, safeguards, upgrade path
```

## Security notes

- Only images, PDFs and plain text open inline. Everything else downloads, so an uploaded HTML or SVG file cannot run script on this site.
- Files are stored under random names. Every query is scoped to the signed-in account.
- Passwords are hashed with scrypt. Session tokens are random and only their hash is stored.
- A folder belongs to one person, and files can only go into folders of the same person.

## Not included yet

- Sharing a person or folder with another account
- OCR or full-text search inside documents
- Login rate limiting (put the app behind a proxy that provides it if it is reachable from the internet)
