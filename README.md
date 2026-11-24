# Geofence Attendance Tracker

## Shared attendance setup

Attendance is stored in a Google Sheet through an Apps Script web app. The spreadsheet stays
private; workers and administrators sign in with accounts listed in its `Workers` tab.

1. Create a Google spreadsheet and, from **Extensions → Apps Script**, add the contents of
   [`apps-script/Code.gs`](./apps-script/Code.gs).
2. In the spreadsheet, create a `Workers` tab with these exact headers in row 1:
   `Punching Number`, `Name`, `Role`, `Password`, `Password Hash`, `Plant`, `Contractor`. The app
   adds missing `Plant` and `Contractor` columns automatically when an administrator opens Accounts.
3. Format the `Punching Number` column as plain text. Add the first administrator row manually:
   enter the admin punching number, name, set `Role` to `Admin`, enter a temporary password in
   `Password`, and leave `Password Hash` empty. The spreadsheet must remain shared only with trusted
   administrators; workers do not need direct sheet access.
4. In the Apps Script editor, select and run `prepareWorkerPasswords`. Approve the requested
   permissions. It creates a unique salted password hash for the initial administrator and clears
   the temporary password cell.
5. In **Project Settings**, set the Apps Script time zone to the workplace's time zone.
6. Select **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access**
   to **Anyone**, then deploy and copy the `/exec` web app URL. Do not share editor access to the
   Apps Script project or spreadsheet with workers.
7. Add a `.env.local` file in the project root:

   ```text
   VITE_ATTENDANCE_API_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
   ```

   Replace the example URL with the one from your deployment. Restart the dev server after changing
   this setting; for a production build, set the same environment variable before building.

When updating the Apps Script after its first deployment, use **Deploy → Manage deployments**, edit
the web app deployment, select **New version**, and deploy it so the existing `/exec` URL serves the
updated code.

Choose **Admin sign in** or **Worker sign in** on the login screen and enter the matching account
details. Apps Script checks the punching number and password against `Workers` and verifies the
account role before returning the corresponding dashboard. After signing in, an administrator can
create and remove worker accounts from **Accounts** in the admin dashboard; these changes are
written to the `Workers` sheet. Removing an account preserves existing attendance records, blocks
future sign-ins, and invalidates that worker's active attendance session. Passwords are hashed by
Apps Script and are never saved in plaintext. Only accounts with the `Admin` role can manage workers
or read the shared attendance register; active accounts with the `Worker` role can submit punches
and view their own attendance history.
Removing a worker requires the administrator's current password, verified by Apps Script.
When creating a worker, administrators select a plant and contractor. The Accounts table can also
update these assignments for existing workers. Older plant values or missing assignments appear as
Unassigned until an administrator selects and saves the correct plant and contractor. Attendance
History can be filtered by plant and contractor; filters use each worker's current assignments.
Plant and contractor choices are shared with the Documents section and are defined in the application
and Apps Script code. Plants are administrative labels only and share the same factory geofence.

Administrators can upload bill copies and work orders from the **Documents** section. Files are
stored in a private `GeoAttend Documents` folder in the Apps Script owner's Google Drive, grouped
into monthly folders, and separated in the app by Bill Copies or Work Orders, Steam Line or
Manpower Supply, plant, and contractor. Previously uploaded files without those assignments appear
under Uncategorized and can be organized from the app. Files can be previewed, downloaded, or moved
to Drive trash inside the app. Deleting a file requires the administrator's current password.
Supported files are JPG, PNG, WebP, and PDF, up to 8 MB each. To authorize private Drive storage, select and run
`prepareDocumentsFolder` once in the Apps Script editor and approve the requested Drive access.
After changing `Code.gs`, deploy a new version of the existing Apps Script web app. Documents are
served only through admin-authenticated app requests; do not make the Drive folder public.

The **Work Orders** section tracks manually entered quantities and ERP work orders/monthly bills.
The Apps Script creates two tabs on first use: `Work Orders` stores the order and Drive reference;
`Monthly Bills` stores the linked bill and Drive reference. Existing columns and rows are retained.
The Apps Script appends `Source Data` and `Line Items` columns to `Work Orders`, and `Source Data`,
`Line Items`, and `Approval Status` columns to `Monthly Bills`. This preserves ERP item codes,
descriptions, UOMs, rates, amounts, dates, contractor identifiers, and document metadata without
replacing the existing manual-entry fields. Older manually saved bills remain counted as approved
to preserve their existing balance behavior. New verified bills are saved as approved only after
the administrator confirms them.

For ERP records, original quantities are retained per item code and UOM. Only approved bill
quantities with matching item code and UOM reduce the balance; different UOMs are never added
together. Bill edits and deletions recalculate progress from the saved ledger. Work-order
duplicates are checked by number and contractor; bill duplicates are checked by voucher number or
work order, contractor bill number, and billing period. The server repeats duplicate and remaining
quantity checks when saving. Keep the spreadsheet private.

Administrators can import JPG/JPEG, PNG, and PDF work orders and monthly bills from the Work Orders
section. The original is first stored in the existing private Drive folder. The Netlify Function
retrieves it only after Apps Script validates the active administrator session, then sends it to
Gemini for structured extraction. The split review view supports image zoom/rotation and editable
header and line-item fields; missing, low-confidence, and marked values are highlighted. A bill
with an uncertain match requires explicit Work Order selection. The existing manual forms remain
available as a fallback.

For automatic extraction, configure these **Netlify environment variables** in the site's settings,
or put them in the ignored root `.env` file for local development:

- `ATTENDANCE_API_URL`: the same HTTPS Apps Script `/exec` URL used by `VITE_ATTENDANCE_API_URL`.
- `GEMINI_API_KEY`: a server-side Gemini API key. Never add this key to `.env.local`, `.env.production`,
  source code, or any `VITE_` variable. Gemini may incur usage charges; review your provider's
  current terms and limits.

After updating `apps-script/Code.gs`, deploy a new version of the existing Apps Script web app.
The work-order sheets are migrated by appending compatible columns when an administrator opens
Work Orders. After deploying the site with the Netlify environment variables, verify document
upload, extraction, preview, and save while signed in as an administrator. If the AI service is
unconfigured or unavailable, use the manual-entry forms.

The `Attendance` tab is created automatically and stores one record per worker per date. Worker
attendance uses `IN`, optional `P1` and `P2` checks, then `OUT`; each event is timestamped by Apps
Script and checks the shared geofence. `IN` is required first, each event can be recorded only once
per day, and no event can be recorded after `OUT`. The app calculates completed shift hours from
`IN` and `OUT` and shows an unfinished shift as Currently Inside.

The original Attendance columns are retained. The app automatically appends `IN`, `P1`, `P2`, and
`OUT` columns to an existing Attendance tab when the updated Apps Script first runs. Older rows
with a `Present` status and a `Time` value are read as legacy `IN` punches, so existing attendance
is preserved; new workers are included automatically from the Workers tab. Apps Script sessions
last up to six hours. Because the deployment is public, use strong, unique passwords and keep the
spreadsheet private. Apps Script checks submitted coordinates against the shared geofence; GPS
coordinates themselves can still be spoofed on a device.

Attendance recorded before this setup remains in the original browser's local storage and is not
automatically imported into the sheet. The sheet retains records until an administrator removes
them; the Attendance Register uses a 16th-to-15th billing period for a selected month, or can display
a custom date range. Workers can view their own read-only attendance register on the dashboard.
Each worker row shows daily IN/OUT times and summarizes present days, absent days, and completed
working hours; hovering over a daily cell shows the full punch breakdown. The factory boundary is
shared through Apps Script settings, so an administrator should save it once after deployment.
Existing local-only boundaries are shown on that device until the administrator saves one to share;
existing circular boundaries can be shared without drawing a polygon.

## Run locally

Install dependencies and open the project folder in VS Code:

```sh
npm install
```

Netlify builds the app with `npm run build` and publishes the generated `dist` directory.
The production Apps Script web app URL is configured in `.env.production` so it is included in
Netlify builds. If you replace the Apps Script deployment with a different `/exec` URL, update
that setting and the Netlify `ATTENDANCE_API_URL` environment variable. This URL is public
client-side configuration, not a credential; access is controlled by the app's account sign-in.
The document Function is deployed from `netlify/functions`; Netlify keeps `GEMINI_API_KEY` server
side and does not expose it in the frontend bundle.

VS Code starts the HTTPS development server when the workspace opens. If prompted, allow automatic tasks for this workspace. Configure the Apps Script URL above, then open `https://localhost:5173/` on this computer; the server must be running for the page to load. To start it manually instead, run `npm.cmd run dev` in a Windows terminal (or `npm run dev` on other platforms). The server uses port 5173 and reports an error instead of silently switching ports if that port is already in use.

Vite's `npm run dev` server does not run Netlify Functions. Create the root `.env` file from the
provided template, paste your Gemini key into `GEMINI_API_KEY`, and run `npm run dev:netlify`
(or `npx netlify dev`) to test the app and function together at `http://localhost:8888/`.
Netlify Dev proxies Vite on port 5173 and provides `/.netlify/functions/...` routes; use the
port-8888 URL while testing extraction. Never put the Gemini key in a `VITE_` variable. Manual
entry remains available when the extraction function is not running.

The development server listens on local and network interfaces and prints the current network URL to open on a phone. The local certificate authority and development certificates are stored under `%USERPROFILE%\.copilot\certificates\geoattendance-local-https`.

### Trust the local HTTPS certificate on Android

1. While the phone is on the same Wi-Fi, open `https://<computer-wifi-ip>:5173/.well-known/geofence-dev-root-ca.crt` to download the public certificate authority certificate. Android may show a certificate warning before the CA is installed; only proceed for this local Wi-Fi development server.
2. In Android Settings, open **Security & privacy** (or **Security**), then **More security settings** → **Encryption & credentials** → **Install a certificate** → **CA certificate**. Menu names vary by Android version. Select the downloaded certificate and approve the warning.
3. Reopen the Vite network URL printed in the terminal. The browser should show a secure connection and account sign-in should work.

The development server uses its existing local CA to sign certificates without attempting to install it into the computer's trust store. The download endpoint serves only the public CA certificate, never its private key. The local CA private key stays on the computer; do not copy or share `rootCA-key.pem`. Remove the installed user CA from Android settings when you no longer need this development server.

Create a production build with `npm run build`.

## Project structure

- `src/App.jsx` selects the login, worker, or admin screen.
- `src/components/` contains the separate React screens.
- `src/utils/` contains authentication, attendance, geofence, and browser-storage logic.
- `src/styles.css` contains the application styles.

Attendance and account credentials are managed through the configured Google Sheet and Apps Script.
The shared factory boundary is saved in Apps Script settings and is checked both in the browser and
again by Apps Script when a worker punches in.

Admins can mark the factory geofence by clicking at least three points around its perimeter on the OpenStreetMap. Undo or clear points before saving. Workers can mark attendance only from inside the saved polygon; existing circular geofences continue to work until replaced by a polygon. Map tiles require an internet connection.

Admins can also open Google Maps on their phone, long-press a point along the factory perimeter, copy its coordinates, and paste them into the dashboard to add it as a boundary point. Coordinate-bearing Google Maps URLs are accepted; shortened sharing links without coordinates are not.
