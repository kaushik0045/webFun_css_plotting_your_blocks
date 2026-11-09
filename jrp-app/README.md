# JRP Client Book

A private app for JRP employees to look up **buyers and sellers**: their contact info, their properties/sites, every comment about them, and a full history of who did what and when.

It works on **iPhone, Android and computers**. Employees open a web link and can "Add to Home Screen" so it behaves like a normal app.

---

## What it does

| Feature | Details |
|---|---|
| Employee login | Each employee has their own email and password. No public sign-up. |
| Roles | **Admin**: everything, plus managing team logins and deleting records. **Staff**: search, add, edit and comment. |
| Search bar | Search by name, phone (any format), email or property address. Filter by Buyers, Sellers or My clients. |
| Client page | Name, type, assigned agent, phone/email with one-tap **Call / Text / Email**, mailing address. |
| Properties / sites | As many addresses as needed per client, each with a **Map** button. |
| Comments | "What happened?" notes, saved automatically with **employee name + date + time**. They can't be edited, so the record stays honest. |
| Full history | Every comment plus every change (edits, properties added, files uploaded) with who and when. |
| Files | Upload documents and photos (up to 20 MB each). |
| Team page (admin) | Add employees, reset passwords, switch someone off when they leave. Their past comments stay. |

---

## Part 1: How the code is organized

```
jrp-app/
├── server.js              ← the "back end": login, rules, and the API the screens talk to
├── src/db.js              ← creates the database tables (users, clients, properties, comments, files, activity)
├── src/sessionStore.js    ← keeps people logged in after a server restart
├── scripts/create-admin.js← makes the first admin login from the command line
├── public/                ← the "front end": what employees see
│   ├── index.html         ← page skeleton
│   ├── app.js             ← all screens: login, search, client page, new/edit, team, my account
│   ├── styles.css         ← colors, layout, phone sizing
│   ├── manifest.webmanifest + sw.js + icons/ ← make it installable on phones
└── data/                  ← created automatically: jrp.db (database) + uploads/ (files). NEVER commit this.
```

**How a search works:**
1. The employee types in the search bar (`public/app.js` → `runSearch()`).
2. The browser asks the server `GET /api/clients?q=maria`.
3. `server.js` checks they're logged in, searches the database, and sends back the list.
4. `app.js` draws the result cards.

**Where to change things:**
- Colors → top of `public/styles.css` (`--navy`, `--gold`).
- Add a new field to clients (e.g. "budget") → add a column in `src/db.js`, read it in `readClientBody()` in `server.js`, and add an input in `viewClientForm()` plus a display line in `viewClient()` in `public/app.js`.
- Wording on screens → search for the text in `public/app.js`.

---

## Part 2: Run it on your own computer

1. Install **Node.js 20 or newer** from https://nodejs.org (choose "LTS").
2. Open a terminal in this `jrp-app` folder and install the packages:
   ```bash
   npm install
   ```
3. Create your admin login (use your real email and a strong password):
   ```bash
   npm run create-admin -- "Your Name" you@jrp.com "ChooseAStrongPassword"
   ```
4. Start the app:
   ```bash
   npm run dev
   ```
5. Open **http://localhost:3000** and log in.

`npm run dev` restarts the server automatically when you edit `server.js`. For changes to `public/` files, just refresh the browser.

To test on your phone while it's on the same Wi-Fi, open `http://YOUR-COMPUTER-IP:3000`.

---

## Part 3: Put it live on Render (recommended)

Render runs the app 24/7 with a secure `https://` link. Cost: **Starter plan (~$7/month) + 5 GB disk (~$1.25/month)**. The disk is required because it's where the database and uploaded files are kept.

### One-time setup
1. Go to https://render.com and **sign up with your GitHub account**.
2. Click **New +** → **Blueprint**.
3. Pick the repository **webFun_css_plotting_your_blocks** and the branch that has this app.
4. Render reads `render.yaml` (in the repo root) and shows a service named **jrp-client-book**. It will ask for 3 values:
   - `ADMIN_EMAIL`: your work email
   - `ADMIN_PASSWORD`: a strong password (you can change it later in the app under **Me**)
   - `ADMIN_NAME`: your name
5. Click **Apply**. The first build takes 2–4 minutes.
6. When it says **Live**, open the link (like `https://jrp-client-book.onrender.com`) and log in.
7. Go to **Team** → **+ Add employee** to create logins for your staff.

`SESSION_SECRET` is generated automatically. Don't share it.

### Updating the app later
Every time you push changes to that GitHub branch, Render rebuilds and redeploys automatically. Your data on the disk is kept.

### Use your own address (e.g. `clients.jrp.com`)
In Render, open the service → **Settings** → **Custom Domains** → add `clients.yourdomain.com`. Render shows a **CNAME** record. Add it at your domain provider (GoDaddy etc.). HTTPS is set up automatically.

---

## Part 4: Install it on phones

Send employees the link, then:

- **iPhone:** open the link in **Safari** → tap **Share** → **Add to Home Screen**.
- **Android:** open in **Chrome** → tap **⋮** → **Install app** (or **Add to Home screen**).

It opens full-screen with the JRP icon. The same instructions are inside the app under **Me**.

---

## Part 5: Keeping data safe

- **Backups:** in Render, open the service → **Disks** → snapshots are taken daily and you can restore one. For an extra copy, download the database from the **Shell** tab with `node -e "require('better-sqlite3')('/var/data/jrp.db').backup('/var/data/backup.db')"`.
- **Someone leaves the company:** go to **Team** → **Manage** → Access: **Off**. They're logged out immediately and their comments stay in the history.
- **Forgot admin password:** in Render's **Shell** tab run
  `npm run create-admin -- "Your Name" you@jrp.com "NewPassword123"`
- Logins lock for 15 minutes after 8 wrong passwords.
- Client data is never cached on phones. Only the app's screens are.

---

## Settings (environment variables)

| Name | Purpose | Default |
|---|---|---|
| `PORT` | Web port | `3000` |
| `DATA_DIR` | Where the database and uploads live | `./data` |
| `SESSION_SECRET` | Secret for login cookies (**required in production**) | — |
| `NODE_ENV` | Set to `production` when live | — |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Creates the first admin if there are no users yet | — |
| `MAX_UPLOAD_MB` | Max size per uploaded file | `20` |
