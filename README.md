# DocuKaksh

A lightweight, self-hosted document manager. Documents are grouped by **person** (or category, such as "Papa", "Office" or "Car"). Each person has nested folders, and folders hold files and more folders.

- Upload by button or drag and drop, with tags and a per-file date
- Preview most common formats in the browser (see the table below), with a details panel: uploader, upload date, file date, size, location, checksum, tags
- Browse, sort by name, size or date, drag files and folders to move them, rename, move, tag, and soft-delete
- Search by file name, or by tag with `#tag`
- Accounts with roles, person assignment, forgot-password requests, and a recycle bin
- Ten themes including Day and Night, chosen per account
- Works on phones and tablets: a drawer menu, bottom sheets, full-screen previews
- SQLite and plain files, no external services, about 20 MB of RAM when idle

## Run with Docker

```bash
docker compose up -d --build
```

Open http://localhost:3000. On first visit, create the account. That account becomes the **super admin**. Setup is only available until the first account exists.

### Where your data is

All app data is in `docukaksh-data/` next to `docker-compose.yml`, a normal folder on the host:

```
docukaksh-data/
  docukaksh.db    accounts, persons, folders, file records, tags, recovery requests
  uploads/        the uploaded files, stored under random names
  previews/       converted previews, rebuilt on demand (safe to delete)
```

Restarts, rebuilds and image upgrades keep this folder. To move the app, stop it, copy `docukaksh-data` and `docker-compose.yml`, then run `docker compose up -d --build` on the new machine. To back up, copy the folder while the app is stopped.

On Linux the container runs as uid 1000. If it cannot write to the folder, run `sudo chown -R 1000:1000 docukaksh-data`.

### Settings

| Variable        | Default | Purpose                                                              |
|-----------------|---------|----------------------------------------------------------------------|
| `DATA_DIR`      | `/data` | Where the database, uploads and previews are stored inside the container |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS                                 |
| `MAX_UPLOAD_MB` | `100`   | Largest accepted single file                                         |
| `PORT`          | `3000`  | HTTP port inside the container                                       |

Put a reverse proxy with HTTPS in front (Caddy, Nginx Proxy Manager, Traefik) and set `COOKIE_SECURE: "true"`.

## Roles and access

| | Super admin | User |
|---|:---:|:---:|
| Create, rename, reorder and move to bin persons | yes | no |
| See and change documents in persons they can access | all persons | assigned persons |
| Create folders, upload, rename, move, tag, delete (to bin) | yes | yes |
| Create accounts, reset passwords, assign persons, disable, delete logins | yes | no |
| Approve forgot-password requests | yes | no |
| Recycle bin: restore, delete forever | yes | no |

- A new account gets a **temporary password** chosen by the super admin, and must choose its own at first sign-in.
- **Persons are assigned to users.** A user only sees the persons ticked for them.
- Deleting a login **keeps the documents**. Persons that account created move to the super admin, and files it uploaded stay, with the uploader shown as "Deleted account".

### Forgot password

1. On the sign-in page, the user selects **Forgot password?** and sends a request, with an optional note.
2. The super admin sees the request under **Admin → Recovery** and chooses **Approve**. A temporary password is shown **once**. Pass it on securely.
3. The user signs in with it and must choose a new password.

Requests give the same answer whether or not the account exists, so the form cannot be used to find accounts.

If the super admin forgets their own password, run this on the server:

```bash
docker compose exec docukaksh node src/cli.js reset-password admin@example.com
```

### Recycle bin

Deleting a person, folder or file moves it to the bin. Everything inside a deleted folder or person goes with it, and comes back on restore. Items deleted separately, earlier, stay in the bin when the parent is restored. Only the super admin can restore or delete forever. Nothing is removed automatically.

## File formats

| Shown directly by the browser | Converted for preview | Download only |
|---|---|---|
| PDF; PNG, JPEG, GIF, WebP, AVIF, BMP, SVG; MP4, WebM; MP3, M4A, WAV, OGG, FLAC | Word `.docx`; Excel `.xlsx`, `.xlsm`; PowerPoint `.pptx`; CSV, TSV; Markdown; HEIC/HEIF (as JPEG); text and code (`txt`, `log`, `json`, `xml`, `html`, `js`, `py`, and about 40 more) | Old binary Office (`.doc`, `.xls`, `.ppt`), OpenDocument, archives (`.zip`, `.rar`, `.7z`), and everything else |

Converted previews are sanitised HTML, shown in a sandboxed frame with no scripts and no network access. A file that cannot be converted (damaged, or password-protected) shows a clear message, and Download always works. Files over 30 MB are not converted.

Two limits to know about: `.xlsx` shows the values stored in the file (formulas are not recalculated), and the HEIC converter was checked for loading but not against a real HEIC photo.

## Themes

Day and Night are the defaults. The other eight are Nord, Dracula, Solarized Light, Solarized Dark, Gruvbox Dark, Catppuccin Mocha, Tokyo Night and Rosé Pine Dawn. Choose one in **Settings** (the account button at the bottom of the sidebar). The choice is saved to the account.

## Run without Docker

Requires Node.js 22.13 or later (Node 24 recommended).

```bash
npm install
npm start          # http://localhost:3000, data in ./data
npm test           # 32 tests: documents API, roles and accounts, previews, recycle bin
```

## Upgrading

Databases from earlier versions are upgraded automatically at startup, and existing data is kept. Persons that were visible to their creator stay visible to them. Files already uploaded are attributed to the person's creator.

## Layout

```
src/
  server.js        entry point (environment, HTTP, shutdown)
  app.js           Express app, security headers, static files
  routes.js        login, accounts, recovery requests, users, recycle bin
  documents.js     persons, folders, files, tags, search, preview and download
  access.js        who can see what; soft delete, restore, permanent delete
  filetypes.js     how each extension is shown
  previews.js      converters (Office, CSV, Markdown, text, HEIC), cached
  permissions.js   roles, permissions and the theme list
  db.js            schema and upgrade steps (node:sqlite, no native build)
  cli.js           command-line tools (password reset for the super admin)
public/            the interface: index.html, styles.css (themes), app.js
test/              api, roles and accounts, and features
```

## Security notes

- Passwords are hashed with scrypt. Session tokens are random, and only their hash is stored.
- Native file types are served inline only when the extension says so. Everything else downloads, so an uploaded HTML or SVG file cannot run script on this site. SVG is served in a sandbox.
- Previews are converted on the server into sanitised HTML and shown in a sandboxed frame.
- Every query is scoped to the signed-in user's access.
- The `.xlsx` reader reads the zip and XML directly. I did not use SheetJS, because the copy on npm has known security advisories.
- `mammoth` (Word) pulls in a moderate denial-of-service advisory in its command-line argument parser. The library does not use that code path, but it is worth updating when a fix is released.

## Not included yet

- Sharing a person or folder with a link
- Full-text search inside documents
- Dragging between persons, and dragging on touch screens (use the Move dialog on phones)
- Automatic emptying of the recycle bin
- Login rate limiting (put a proxy in front if the app is reachable from the internet)
