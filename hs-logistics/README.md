# HS Logistics — Dispatch & Driver Tracking

Two apps that share one Supabase backend:

| Part | What it does | Who uses it |
|---|---|---|
| `dispatcher/` | Web dashboard: **live map of every truck**, upload rate confirmations, create & assign loads, manage drivers | You (dispatch) |
| `driver-app/` | Phone app (Android + iPhone): shows the driver their load, sends GPS **all the time, even when the app is closed** | Drivers |
| `supabase/schema.sql` | Database tables, security rules, realtime | — |

## How the rate stays private

- The rate con PDF is read **inside your browser** (pdf.js). It is never uploaded anywhere.
- Before any parsing, every line that mentions money (`$`, rate, line haul, fuel surcharge, total, lumper, detention…) is thrown away.
- Only these fields are saved: facility, address, appointment, PU/reference numbers, load #, broker name.
- The save button refuses to save if any field contains a `$` amount.
- The database security rules let a driver read only *their own* loads and change only stop status — never addresses, numbers, or other drivers' data.

## How live location works

- The driver app starts a background location service as soon as the driver signs in. On Android it shows a permanent “Sharing your location with dispatch” notification (Android requires this); on iPhone the blue location pill shows.
- About one point every 30 s while driving (or every 150 m), and it keeps reporting while parked so you know the phone is alive.
- **No signal?** Points are saved on the phone (up to ~7 days) and uploaded when coverage returns, so the trail has no gaps.
- The dashboard map updates instantly (Supabase Realtime). Truck pins are **green** = updated in last 5 min, **amber** = 5–30 min, **red** = over 30 min / no signal, **grey** = driver signed out.
- Click a driver to see their last 12 hours of travel as a blue line, their speed, battery level, current load and next stop.
- Tracking stops only if the driver signs out (the dashboard shows “Tracking off”).

---

## Try it first (demo mode)
```bash
cd hs-logistics/dispatcher && npm install && npm run dev
```
With no Supabase keys the dashboard opens in **demo mode**: 7 sample trucks moving on real interstates, sample loads, and working rate-con upload. Nothing is saved. Add `?demo` to the address to force demo mode later.

## Setup (one time, ~30 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com → **New project** (free tier is fine).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. (Optional) **Authentication → Providers → Email**: turn off “Confirm email” if you don't want drivers to click an email link before their first sign-in.

### 2. Run the dispatcher dashboard
```bash
cd hs-logistics/dispatcher
cp .env.example .env      # paste the URL and anon key into .env
npm install
npm run dev               # opens http://localhost:5173
```
To put it online, deploy the `dispatcher` folder to Vercel or Netlify (build command `npm run build`, output folder `dist`, and add the same two env variables).

### 3. Make yourself the dispatcher
1. Create your login: Supabase → **Authentication → Users → Add user** (email + password).
2. In the SQL Editor run (with your email):
   ```sql
   update public.profiles set role = 'dispatcher'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Sign in to the dashboard.

### 4. Build the driver app
Background tracking needs a real installed app (it does **not** work inside the Expo Go preview app).
```bash
cd hs-logistics/driver-app
cp .env.example .env      # same URL and anon key
npm install
npm install -g eas-cli
eas login                 # free Expo account
eas build -p android --profile preview    # gives you an .apk download link
eas build -p ios --profile preview        # needs an Apple Developer account ($99/yr)
```
Send drivers the link. Later you can publish to Google Play / App Store with `eas submit`.

### 5. Add drivers
Drivers install the app → **Create account** → allow location **“Allow all the time”** (Android) or **“Always”** (iPhone).
They appear in the dashboard under **Drivers** right away. Set their truck number there.

**Android tip:** on Samsung/Xiaomi/etc. ask drivers to set the app's Battery setting to **Unrestricted**, otherwise the phone may kill tracking to save battery. The app shows a reminder.

---

## Daily use
1. **Loads → + New load from rate con** → pick the PDF.
2. Check the fields it filled in (fix anything it missed — every broker's PDF is different), choose the driver → **Save & send to driver**.
3. The driver gets the load instantly, taps **Navigate** for directions, and taps **I've arrived** / **Loaded — leaving** at each stop. You see the status on the load board and the truck on the map.

## Rate con reading — limits
Text rules read most common layouts (labelled “Shipper/Pickup” and “Consignee/Delivery” blocks, “Stop 1 – Pick Up”, one-line or two-line addresses, PU#/BOL#/PO#/SO#/Release#, FCFS).
They can miss things on:
- **Scanned PDFs** (a photo of paper — no text inside). The app tells you, and you type the stops in.
- **Side-by-side columns** (Shipper and Consignee printed next to each other). Review those carefully.

If a particular broker keeps coming out wrong, save one of their PDFs (with the rate blacked out) and the rules in `dispatcher/src/lib/rateconParser.js` can be extended — add a test for it in `dispatcher/test/`.

## Development
```bash
cd dispatcher && npm test     # parser tests, including a real PDF
```
