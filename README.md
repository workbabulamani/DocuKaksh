# DocuKaksh

A lightweight, self-hosted document manager. Documents are organised by **person** (or category, such as "Papa", "Office" or "Car"). Each person has their own **nested folders**, and folders can hold files and more folders.

- Upload (drag and drop, or a button), with a progress bar
- Browse, preview (images, PDF, text), download, rename, move, delete
- Create nested folders to any depth
- Search file names across every person
- Single-file deployment with a SQLite database and no external services

## Run with Docker (recommended)

```bash
docker compose up -d --build
```

Open http://localhost:3000. On first visit, create the account. Setup is only available until the first account exists.

Your data lives in the `docukaksh-data` Docker volume: the SQLite database and the uploaded files.

| Variable        | Default | Purpose                                                              |
|-----------------|---------|----------------------------------------------------------------------|
| `PORT`          | `3000`  | HTTP port inside the container                                       |
| `DATA_DIR`      | `/data` | Where the database and uploads are stored                            |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS, so the session cookie is HTTPS-only |
| `MAX_UPLOAD_MB` | `100`   | Largest accepted single file                                         |

### HTTPS

Put a reverse proxy in front (Caddy, Nginx Proxy Manager, Traefik). Set `COOKIE_SECURE: "true"` once HTTPS is in use.

### Backups

Copy the volume, or run this while the container is stopped:

```bash
docker run --rm -v docukaksh-data:/data -v "$PWD":/backup alpine tar czf /backup/docukaksh-backup.tgz -C /data .
```

## Run without Docker

Requires Node.js 22.13 or later (Node 24 recommended).

```bash
npm install
npm start          # http://localhost:3000
npm test           # API test suite
```

## Layout

```
src/
  server.js   entry point (reads env, starts HTTP, handles shutdown)
  app.js      Express app, security headers, static files
  routes.js   REST API: auth, persons, folders, files, search
  auth.js     scrypt password hashing, session tokens
  db.js       SQLite schema (node:sqlite, no native build)
public/
  index.html, styles.css, app.js   the UI (no build step)
test/
  api.test.js                       end-to-end API tests
```

## Design notes

- **Footprint.** Node's built-in `node:sqlite` replaces a native database driver, and there is no frontend build. The container idles at around 20 MB of RAM.
- **Safety.** Only images, PDFs and plain text are shown inline. Everything else downloads, so an uploaded HTML or SVG file cannot run script on this site. Files are stored under random names, and every query is scoped to the signed-in account.
- **Hierarchy.** A folder belongs to one person. Files can only be placed in folders of the same person. A folder cannot be moved into itself or its own subfolders.

## Not included yet

- Multiple user accounts and sharing between them (the data model already has a `user_id` on each person)
- OCR or full-text search inside documents
- Login rate limiting (put the app behind a proxy that does this if it is exposed to the internet)
