# INAAC QR Demo — Starter Project
This starter demonstrates the core workflow:
1. Staff opens the Android app.
2. Scans a participant QR URL such as `https://batch1.inacc.in/001`.
3. The app extracts `001`.
4. The app calls the FastAPI backend.
5. The participant profile is displayed.

It also includes manual roll-number lookup and five fictional sample participants.

## Project structure

```text
INAAC-QR-Demo/
├── backend/
│   ├── app/
│   │   └── main.py
│   ├── requirements.txt
│   └── README.md
└── mobile-app/
    ├── App.js
    ├── app.json
    └── package.json
```

## Part A — Start the backend (Windows + Git Bash)

Open Git Bash:

```bash
cd /c/Users/YED/OneDrive/Desktop/inaac_attendance/INAAC-QR-Demo/backend
python -m venv venv
source venv/Scripts/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

If you extracted the ZIP somewhere else, change the `cd` path accordingly.

Test on your computer:
- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/docs
- http://127.0.0.1:8000/api/v1/participants/001

The demo backend uses SQLite and creates `inaac_demo.db` automatically. Five fictional records are inserted on first startup.

## Part B — Find your computer's local IP

Your Android phone and computer must be on the same Wi-Fi network.

In Git Bash, run:

```bash
ipconfig
```

Find the Wi-Fi adapter's `IPv4 Address`, for example `192.168.1.20`.

In `mobile-app/App.js`, replace:

```js
const API_BASE_URL = "http://192.168.1.20:8000";
```

with your computer's actual IPv4 address. Do not use `127.0.0.1` on the phone.

## Part C — Start the Expo app

Open a second Git Bash terminal:

```bash
cd /c/Users/YED/OneDrive/Desktop/inaac_attendance/INAAC-QR-Demo/mobile-app
npm install
npx expo start
```

Install **Expo Go** on your Android phone, connect the phone to the same Wi-Fi, and scan the QR shown by Expo. If LAN discovery fails, try:

```bash
npx expo start --tunnel
```

Grant camera permission when prompted.

## QR format

The scanner accepts URLs on `batch1.inacc.in`, for example:

- `https://batch1.inacc.in/001`
- `https://batch1.inacc.in/002`

It also accepts a plain roll number such as `001` for controlled testing.

The QR code should encode the full public itinerary URL. The mobile app extracts only the final path segment and uses it as the participant code.

## Important demo limitations

- This is a demonstration starter, not production-ready software.
- The demo API has no authentication. Do not put real children's data into it or expose it publicly.
- The SQLite database is local to the backend. It is not Railway PostgreSQL yet.
- The app uses HTTP for local Wi-Fi testing. Production deployment must use HTTPS.
- The sample guardian contact numbers are fictional.
- Attendance, dispersal, Cloudinary photo upload, staff authentication, admin dashboard and production PostgreSQL migrations are intentionally not implemented in this QR-first starter.

## Quick end-to-end test

1. Start the backend.
2. Start the Expo app on your Android phone.
3. In the app, manually search `001`; confirm Aarav Sharma appears.
4. Open `https://batch1.inacc.in/001` on another screen and show its QR code, or generate a QR code containing that URL.
5. In the app, tap **Scan QR Code** and scan it.
6. Confirm the same participant profile appears.

If the app cannot connect:
- Confirm phone and computer are on the same Wi-Fi.
- Confirm `API_BASE_URL` uses the computer's IPv4 address.
- Allow Python through Windows Firewall on private networks.
- Keep the backend terminal running.