# Geofence Attendance Tracker

## Shared attendance setup

Attendance is stored in a Google Sheet through an Apps Script web app. The spreadsheet stays
private; workers and administrators sign in with accounts listed in its `Workers` tab.

1. Create a Google spreadsheet and, from **Extensions → Apps Script**, add the contents of
   [`apps-script/Code.gs`](./apps-script/Code.gs).
2. In the spreadsheet, create a `Workers` tab with these exact headers in row 1:
   `Punching Number`, `Name`, `Role`, `Password`, `Password Hash`, `Plant`. The app adds the
   `Plant` column automatically for an existing deployment when an administrator opens Accounts.
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
or read shared attendance; only active accounts with the `Worker` role can submit a punch.
The Accounts plant dropdown filters workers and sets the plant for new accounts; choose Plant 1 or
Plant 2 before creating a worker. Existing workers without a plant are shown as Unassigned; enter
their plant in the `Plant` column of the private `Workers` sheet. Plant names can be changed in the
`PLANTS` list in the application and Apps Script code, then deployed again. Plants are administrative
labels only and share the same factory geofence.
The `Attendance` tab is created automatically and stores one record per worker per date;
repeat punches update that day's time. Apps Script sessions last up to six hours. Because the
deployment is public, use strong, unique passwords and keep the spreadsheet private. Apps Script
checks submitted coordinates against the shared geofence; GPS coordinates themselves can still be
spoofed on a device.

Attendance recorded before this setup remains in the original browser's local storage and is not
automatically imported into the sheet. The sheet retains records until an administrator removes
them; the dashboard date picker shows the most recent three calendar months. The factory boundary
is shared through Apps Script settings, so an administrator should save it once after deployment.
Existing local-only boundaries are shown on that device until the administrator saves one to share;
existing circular boundaries can be shared without drawing a polygon.

## Run locally

Install dependencies and open the project folder in VS Code:

```sh
npm install
```

VS Code starts the HTTPS development server when the workspace opens. If prompted, allow automatic tasks for this workspace. Configure the Apps Script URL above, then open `https://localhost:5173/` on this computer; the server must be running for the page to load. To start it manually instead, run `npm.cmd run dev` in a Windows terminal (or `npm run dev` on other platforms). The server uses port 5173 and reports an error instead of silently switching ports if that port is already in use.

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
