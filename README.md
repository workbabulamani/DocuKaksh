# DocuKaksh

A lightweight, self-hosted document manager. Documents are grouped by **person** (or category, such as "Papa", "Office" or "Car"). Each person has nested folders, and folders hold files and more folders. Share folders or files with other accounts, store everything encrypted, and keep an audit trail.

## Set up

1. Create the secrets file:

   ```bash
   cp .env.example .env
   npm run gen-key            # or: docker compose run --rm docukaksh node src/cli.js gen-key
   ```

   Put the printed key into `.env` as `ENCRYPTION_KEY`. **Keep a copy of this key somewhere safe.** Without it the stored files cannot be opened, and the app will not start.

2. Start it:

   ```bash
   docker compose up -d --build
   ```

3. Open http://localhost:3000 and create the super admin account. Setup is only available until the first account exists.

Everything secret or machine-specific lives in `.env`: the encryption key, the port, the data folder (`DATA_HOST_DIR`), upload size, recycle bin retention, and sign-in protection. `.env` is never copied into the image or committed.

## Use it from other devices (phone, tablet, another computer)

The app listens on every network interface (`HOST=0.0.0.0`). When it starts, it prints the addresses to use, for example:

```
On this computer:  http://localhost:3000
On your network:   http://192.168.0.154:3000
```

Open the second address on the other device while it is on the same Wi-Fi or network.

**If the other device cannot connect, Windows Firewall is blocking the port.** Allow it once, in PowerShell opened as administrator:

```powershell
New-NetFirewallRule -DisplayName "DocuKaksh" -Direction Inbound -Protocol TCP -LocalPort 3000 -Profile Private -Action Allow
```

Check that the Wi-Fi network is set to **Private** (Settings → Network & internet → Wi-Fi → your network). The firewall rule applies to Private networks only, which is the safe default for a home network.

To allow only this computer, set `HOST=127.0.0.1` in `.env`.


## Two-factor sign-in (authenticator app)

Optional and per account. Turn it on in **Settings → Account → Two-factor sign-in**: scan the QR code with Google Authenticator, Microsoft Authenticator, Authy or a similar app, or type the key in by hand. Confirm with a code from the app, then sign-in asks for a code after the password.

- **Don’t ask again on this browser for 30 days** on the code screen skips the code on that browser only.
- Turning it off asks for the password.
- If the authenticator app is lost, a super admin can run `docker compose exec docukaksh node src/cli.js disable-2fa <email>` on the server.

## Backups

**Settings → Administration → Backups** (super admin):

- **Back up now**, or a schedule: manual only, every day, or every week at a chosen time. Old backups beyond the number you keep are removed.
- Each backup is a consistent copy of the database plus every encrypted file. Files that have not changed are shared with the previous backup, so backups stay small.
- **Download** a backup as a zip file, **restore** one from the list, or restore from a zip file you upload.
- A restore moves the current data into a folder named `before-restore-…` (nothing is deleted), then the app restarts to apply the backup. In Docker the container restarts itself. Without Docker, start the app again.
- Backups need the same `ENCRYPTION_KEY` as the data they came from. Keep the key safe.
- Set `BACKUP_DIR` in `.env` to keep backups on another drive.

## Languages

Settings → Account → Language. English, Hindi, Bengali, Telugu, Tamil, Marathi, Urdu, Spanish, French, German, Chinese and Arabic. The main screens are translated; file names, messages and some dialogs are still English. Translations are a first version and should be checked by native speakers. Arabic and Urdu switch the layout to right-to-left.

## Profile

Settings → Account: first name, last name, phone and organisation.

## Long folders

Lists are split into pages. Choose how many items per page in Settings → Appearance (10, 25, 50, 100 or 200).

## Where data is stored

Inside the data folder (`DATA_HOST_DIR`, default `./docukaksh-data`):

```
docukaksh.db    accounts, persons, folders, file records, tags, shares, audit log
uploads/        every uploaded file, encrypted (AES-256-GCM)
previews/       converted previews, encrypted, rebuilt on demand
```

To move the app, stop it, copy the data folder and `.env`, then start it again. To use another drive, set `DATA_HOST_DIR` in `.env`, for example `D:/DocuKaksh-data`.

On Linux the container runs as uid 1000. If it cannot write to the folder, run `sudo chown -R 1000:1000 <folder>`.

**What is and is not encrypted.** File contents are always encrypted. File names, folder names, descriptions, tags and the audit log are stored in the SQLite database, which is not encrypted. For full protection of that metadata too, put the data folder on an encrypted disk (BitLocker, LUKS or FileVault).

## Settings (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | none, required | 32 random bytes, base64. Created with `npm run gen-key` |
| `DATA_HOST_DIR` | `./docukaksh-data` | Host folder for all app data |
| `PORT` | `3000` | HTTP port on this machine |
| `COOKIE_SECURE` | `false` | `true` when served over HTTPS |
| `MAX_UPLOAD_MB` | `100` | Largest single file |
| `RECYCLE_RETENTION_DAYS` | `30` | Bin items are removed for good after this many days (`0` keeps them) |
| `LOGIN_MAX_FAILURES` | `5` | Failed sign-ins before an account or address is locked |
| `LOGIN_LOCK_MINUTES` | `15` | How long the lock lasts |

Put HTTPS in front with a reverse proxy (Caddy, Nginx Proxy Manager, Traefik) and set `COOKIE_SECURE=true`.

## What people can do

| | Super admin | User |
|---|:---:|:---:|
| Create, rename, reorder and move to bin persons | yes | no |
| See and change documents in persons assigned to them | all persons | assigned persons |
| Create folders, upload, rename, move, tag, describe, delete (to bin) | yes | in their persons and shared folders |
| Share a folder or file with another account | yes | with edit permission |
| Create accounts, reset passwords, assign persons, disable, delete logins | yes | no |
| Recycle bin: restore, delete forever | yes | no |
| Audit log, system health | yes | no |

### Sharing

- **Share with another account** from the ⋯ menu or the preview panel. Choose a permission:
  - **View**: open and download. Cannot change anything.
  - **Edit**: open, change, move, delete, and share onwards.
  - **Upload only** (drop-box): can add files to the folder but cannot see what is inside.
- Sharing a folder covers everything inside it. Folders above the shared one stay hidden.
- Shared items appear under **Shared with me** in the sidebar.
- Removing a share takes effect immediately.

### Share to other apps

On phones and in browsers that support it, **Share to other apps** opens the system share sheet with the file attached, so you can send it by WhatsApp, email and so on. Where the browser cannot share files, the file is downloaded instead.

### Recovery and sign-in protection

- **Forgot password?** on the sign-in page sends a request to the super admin. Approving it shows a temporary password once. The user must choose their own password at sign-in.
- Too many failed sign-ins lock the account for a while, even with the right password afterwards.
- If the super admin is locked out:
  ```bash
  docker compose exec docukaksh node src/cli.js reset-password admin@example.com
  ```

### Recycle bin

Deleting a person, folder or file moves it to the bin, and everything inside it goes too. Restoring brings it back in place. Items older than `RECYCLE_RETENTION_DAYS` are removed automatically. Only the super admin can restore or delete forever.

### Duplicates, stars, expiry and the dashboard

- Uploading a file that is identical to one already stored shows a warning. The dashboard lists duplicate groups.
- Star files and folders for quick access under **Starred**.
- Give a file an expiry date. The **Home** dashboard lists what expires in the next 30 days.
- **Home** also shows storage used, counts per person, and recent activity.

## Capturing and importing

- **Take photo** (phones) takes a picture and files it straight into the folder you are in.
- **Import folder** (desktop browsers) recreates a whole folder tree: names, nesting, and each file's date. Folder dates are the time of import.
- Drag files and folders onto a folder or breadcrumb to move them. On phones, use the Move dialog.

## Look and accessibility

Settings are in the account button at the bottom of the sidebar:

- **Appearance**: sixteen themes. Day and Night are the defaults; the others are Nord, Dracula, Solarized Light and Dark, Gruvbox Dark, Catppuccin Mocha, Tokyo Night, Rosé Pine Dawn, One Dark, Monokai, GitHub Light, Everforest Light, Ayu Dark and Material Ocean. Also comfortable or compact density.
- **Accessibility**: normal, large or extra large text, and high contrast.
- **Account**: change password and sign out.
- **Administration** (super admin, inside Settings): users, recovery requests, audit log and system health. The recycle bin stays in the sidebar.
- **Accent colours**: pick a primary and a secondary colour, use a preset, or reset to the theme colours.
- **About**: version and a summary of how data is protected.

The sidebar collapses on desktop to an icon rail, where each person shows as a colour circle with their initials (for example **SL** for Sagar Lamani). Drag the sidebar edge to change its width (or use the arrow keys when it has focus). The Persons group folds open and closed; Home, Shared with me, Starred and the Recycle bin stay fixed at the top. Click your name at the bottom of the sidebar for Settings and Sign out.

## Run without Docker

Requires Node.js 22.13 or later (Node 24 recommended).

```bash
npm install
cp .env.example .env       # then set ENCRYPTION_KEY
npm start                  # http://localhost:3000
npm test                   # 48 tests
```

## Upgrading

Earlier versions are upgraded automatically at startup, and existing data is kept. Files stored before encryption existed are encrypted on the first start with the new version. That first start needs `ENCRYPTION_KEY` set. Back up the data folder before upgrading.

## Layout

```
src/
  server.js        entry point: reads configuration, starts HTTP
  config.js        settings from .env and the environment
  app.js           Express app, security headers, startup maintenance
  routes.js        sign-in, accounts, lockout, recovery, recycle bin, audit, health
  documents.js     persons, folders, files, sharing, stars, search, dashboard
  access.js        who can see and change what; shares; soft delete and restore
  vault.js         encryption at rest (AES-256-GCM, chunked, tamper-checked)
  maintenance.js   encrypts older files on upgrade; empties the bin
  audit.js         audit trail
  previews.js      converters (Office, CSV, Markdown, text, HEIC), cached encrypted
  filetypes.js     how each file type is shown
  icons.js         folder icon set
  permissions.js   roles and themes
  db.js            schema and upgrade steps (node:sqlite)
  cli.js           gen-key, reset-password
public/            the interface: index.html, styles.css, features.css, app.js
test/              api, security, roles and accounts, features
```

## Not built yet

These were in the request and are not in this version:

- Public share links with a password and an expiry date
- Two-factor sign-in (authenticator app)
- Single sign-on (Google, Microsoft or other OpenID Connect provider)
- Email and push notifications
- Scheduled backups with restore from the admin screen
- Storage quotas per user or person
- Custom fields per person with reminders
- Version history for files

## Security notes

- Passwords are hashed with scrypt. Session tokens are random, and only their hash is stored.
- Files are encrypted before they are written. A tampered or truncated file is refused rather than served.
- Native file types are shown inline only when the extension says so. Everything else downloads. SVG is served in a sandbox.
- Previews are converted on the server into sanitised HTML and shown in a sandboxed frame.
- Access is checked on every request, including shared items.
- The `.xlsx` reader reads the zip and XML directly. SheetJS is not used because its npm copy has known advisories.
- `mammoth` (Word) pulls in a moderate denial-of-service advisory in a command-line parser that the library never runs. Update it when a fix is released.
- Sign-in protection counts failures per account and per address. Behind a shared IP, one person's mistakes can lock others out for the lock period.
