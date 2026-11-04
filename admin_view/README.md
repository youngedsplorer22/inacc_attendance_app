# INAAC Admin Dashboard

Separate React + Vite admin frontend for the existing INAAC FastAPI backend.

## Features
- Single predefined admin login using the backend `/api/admin/login` endpoint.
- Dashboard cards: total participants, present today, currently inside, absent today.
- Date picker; date is sent to the backend as `YYYY-MM-DD`.
- Participant spreadsheet-style table with search, status filter, sorting, sticky header and expandable detail rows.
- Export **all participants for the selected date** to a locally generated `.xlsx` Excel workbook (not just the currently visible search results).
- Auto-refresh every 10 seconds.
- Uses the existing backend; does not modify the staff mobile app or database.

## Run locally (Git Bash)
```bash
cd admin-dashboard
npm install
cp .env.example .env
npm run dev
```
Open http://localhost:5173

The `.env` file should contain:
```env
VITE_API_BASE_URL=https://inaccattendanceapp-production.up.railway.app
```
Do not put admin credentials in this file. Login credentials are checked by the backend.

## Backend requirements
The backend must expose:
- `POST /api/admin/login`
- `GET /api/admin/me`
- `POST /api/admin/logout`
- `GET /api/admin/dashboard?date=YYYY-MM-DD`
- `GET /api/admin/employees?date=YYYY-MM-DD`

The frontend sends `Authorization: Bearer <token>` for protected endpoints.

For local development, backend CORS must allow `http://localhost:5173` and `http://127.0.0.1:5173`.

## Excel export
Click **Export Excel** above the participant table. It downloads an `.xlsx` file to the browser's normal Downloads folder. The export contains all participants returned by the API for the selected date, including contact, school, team, attendance timestamps and status.

## Deploy
Build with `npm run build`, then deploy the project folder to Vercel as a Vite app. Add:
`VITE_API_BASE_URL=https://inaccattendanceapp-production.up.railway.app`
as a Vercel environment variable, and add the exact Vercel origin to backend `ADMIN_CORS_ORIGINS` (comma-separated if multiple origins).
