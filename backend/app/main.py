# import os
# from pathlib import Path
# import psycopg
# from psycopg.rows import dict_row
# from dotenv import load_dotenv
# import cloudinary
# import cloudinary.uploader
# from fastapi import FastAPI, HTTPException, Query, UploadFile, File
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import BaseModel, Field
import os
import json
import time
import hmac
import hashlib
import base64
import urllib.request
import urllib.error
from pathlib import Path
from datetime import date, datetime
from zoneinfo import ZoneInfo
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv
import cloudinary
import cloudinary.uploader
from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    UploadFile,
    File,
    Depends,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
APP_DIR = Path(__file__).resolve().parent
load_dotenv(APP_DIR.parent / ".env", override=True)
DATABASE_URL = os.getenv("DATABASE_URL")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
ADMIN_TOKEN_SECRET = os.getenv("ADMIN_TOKEN_SECRET")
admin_security = HTTPBearer(auto_error=False)
app = FastAPI(
    title="INAAC Attendance API",
    description="Participant lookup and four-day attendance management.",
    version="1.1.0",
)
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ] + [
        origin.strip()
        for origin in os.getenv("ADMIN_CORS_ORIGINS", "").split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --------------------------------------------------
# DOUBLETICK WHATSAPP NOTIFICATIONS
# --------------------------------------------------
DOUBLETICK_API_KEY = os.getenv("DOUBLETICK_API_KEY")
DOUBLETICK_FROM_NUMBER = os.getenv("DOUBLETICK_FROM_NUMBER", "+917048950667")
DOUBLETICK_PRESENT_TEMPLATE = os.getenv(
    "DOUBLETICK_PRESENT_TEMPLATE", "inacc_parent_consent_form"
)
DOUBLETICK_DISPERSAL_TEMPLATE = os.getenv("DOUBLETICK_DISPERSAL_TEMPLATE", "")
DOUBLETICK_LANGUAGE = os.getenv("DOUBLETICK_LANGUAGE", "en")
DOUBLETICK_API_URL = "https://public.doubletick.io/v2/whatsapp/message/template"
def normalize_whatsapp_number(raw_number):
    """Return an international-format number, or None if it is unusable."""
    if not raw_number:
        return None
    raw = str(raw_number).strip()
    if raw.startswith("+"):
        digits = "".join(ch for ch in raw[1:] if ch.isdigit())
        return f"+{digits}" if 10 <= len(digits) <= 15 else None
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 10:
        # Local 10-digit numbers in this INAAC database are Indian numbers.
        return f"+91{digits}"
    if digits.startswith("91") and len(digits) == 12:
        return f"+{digits}"
    if digits.startswith("971") and len(digits) == 12:
        return f"+{digits}"
    if 10 <= len(digits) <= 15:
        return f"+{digits}"
    return None
def send_doubletick_template(phone_number, template_name):
    """
    Enqueue a DoubleTick V2 template message.
    This function is called only after the attendance transaction commits.
    WhatsApp failures are returned as status data and never undo attendance.
    """
    if not template_name:
        return {"status": "SKIPPED", "reason": "No template configured"}
    if not DOUBLETICK_API_KEY:
        return {"status": "SKIPPED", "reason": "DOUBLETICK_API_KEY is not configured"}
    recipient = normalize_whatsapp_number(phone_number)
    if not recipient:
        return {"status": "SKIPPED", "reason": "Participant phone number is missing or invalid"}
    payload = {
        "messages": [
            {
                "from": DOUBLETICK_FROM_NUMBER,
                "to": recipient,
                "content": {
                    "templateName": template_name,
                    "language": DOUBLETICK_LANGUAGE,
                    "templateData": {},
                },
            }
        ]
    }
    request = urllib.request.Request(
        DOUBLETICK_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": DOUBLETICK_API_KEY,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw_response = response.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw_response) if raw_response else {}
            result = parsed[0] if isinstance(parsed, list) and parsed else parsed
            return {
                "status": result.get("status", "ACCEPTED") if isinstance(result, dict) else "ACCEPTED",
                "message_id": result.get("messageId") if isinstance(result, dict) else None,
            }
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        # Do not expose the API key or full recipient number in logs/API response.
        print(f"DoubleTick HTTP error {exc.code}: {error_body[:500]}")
        return {"status": "FAILED", "reason": f"DoubleTick HTTP {exc.code}"}
    except Exception as exc:
        print(f"DoubleTick request failed: {type(exc).__name__}: {exc}")
        return {"status": "FAILED", "reason": "DoubleTick request failed"}
def get_connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is missing. Check backend/.env")
    return psycopg.connect(
        DATABASE_URL,
        row_factory=dict_row,
    )
class AttendanceRequest(BaseModel):
    event_day: int = Field(ge=1, le=4)
class ParticipantUpdateRequest(BaseModel):
    roll_no: str | None = Field(default=None, max_length=30)
    child_name: str | None = Field(default=None, max_length=200)
    phone_no: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=254)
    school_name: str | None = Field(default=None, max_length=250)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    grade: str | None = Field(default=None, max_length=50)
    team_no: str | None = Field(default=None, max_length=50)
    group_no: str | None = Field(default=None, max_length=50)
@app.get("/")
def root():
    return {
        "success": True,
        "service": "INAAC Attendance API",
    }
@app.get("/health")
def health():
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1")
        return {
            "status": "healthy",
            "database": "connected",
        }
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed. Check backend configuration.",
        )
# --------------------------------------------------
# PARTICIPANT LOOKUP
# --------------------------------------------------
@app.get("/api/v1/participants/{roll_no}")
def get_participant(
    roll_no: str,
    event_day: int = Query(default=1, ge=1, le=4),
):
    code = roll_no.strip()
    if not code or len(code) > 30:
        raise HTTPException(
            status_code=400,
            detail="Invalid roll number",
        )
    with get_connection() as conn:
        participant = conn.execute(
            """
            SELECT
                p.id,
                p.roll_no,
                p.email,
                p.child_name,
                p.school_name,
                p.city,
                p.state,
                p.region,
                p.grade,
                p.phone_no,
                p.team_no,
                p.group_no,
                p.image_url,
                p.cloudinary_public_id,
                p.in_premise,
                CASE
                    WHEN ar.in_time IS NOT NULL
                    THEN 'present'
                    ELSE NULL
                END AS attendance_status,
                CASE
                    WHEN ar.out_time IS NOT NULL
                    THEN 'dispersed'
                    ELSE NULL
                END AS dispersal_status,
                ar.in_time,
                ar.out_time
            FROM participants p
            LEFT JOIN attendance_records ar
                ON ar.participant_id = p.id
                AND ar.event_day = %s
            WHERE p.roll_no = %s
            """,
            (event_day, code),
        ).fetchone()
    if participant is None:
        raise HTTPException(
            status_code=404,
            detail="Participant not found",
        )
    return {
        "success": True,
        "participant": participant,
    }
# --------------------------------------------------
# UPDATE PARTICIPANT DETAILS
# --------------------------------------------------
@app.patch("/api/v1/participants/{roll_no}")
def update_participant(
    roll_no: str,
    request: ParticipantUpdateRequest,
):
    current_roll_no = roll_no.strip()
    if not current_roll_no:
        raise HTTPException(status_code=400, detail="Invalid roll number.")
    updates = request.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail="No participant details were provided for update.",
        )
    if "roll_no" in updates:
        if updates["roll_no"] is None or not updates["roll_no"].strip():
            raise HTTPException(status_code=400, detail="Roll number cannot be blank.")
        updates["roll_no"] = updates["roll_no"].strip()
    if "child_name" in updates:
        if updates["child_name"] is None or not updates["child_name"].strip():
            raise HTTPException(status_code=400, detail="Participant name cannot be blank.")
        updates["child_name"] = updates["child_name"].strip()
    allowed_columns = {
        "roll_no", "child_name", "phone_no", "email", "school_name",
        "city", "state", "region", "grade", "team_no", "group_no",
    }
    updates = {
        column: value.strip() if isinstance(value, str) else value
        for column, value in updates.items()
        if column in allowed_columns
    }
    if not updates:
        raise HTTPException(status_code=400, detail="No valid participant fields were provided.")
    with get_connection() as conn:
        participant = conn.execute(
            """
            SELECT id, roll_no
            FROM participants
            WHERE roll_no = %s
            FOR UPDATE
            """,
            (current_roll_no,),
        ).fetchone()
        if participant is None:
            raise HTTPException(status_code=404, detail="Participant not found.")
        new_roll_no = updates.get("roll_no")
        if new_roll_no and new_roll_no != current_roll_no:
            duplicate = conn.execute(
                """
                SELECT id
                FROM participants
                WHERE roll_no = %s AND id <> %s
                """,
                (new_roll_no, participant["id"]),
            ).fetchone()
            if duplicate:
                raise HTTPException(
                    status_code=409,
                    detail=f"Roll number {new_roll_no} is already assigned to another participant.",
                )
        set_clause = ", ".join(f"{column} = %s" for column in updates.keys())
        values = list(updates.values()) + [participant["id"]]
        updated = conn.execute(
            f"""
            UPDATE participants
            SET {set_clause},
                updated_at = NOW()
            WHERE id = %s
            RETURNING
                id, roll_no, child_name, phone_no, email, school_name,
                city, state, region, grade, team_no, group_no,
                image_url, cloudinary_public_id, in_premise
            """,
            values,
        ).fetchone()
    return {
        "success": True,
        "message": "Participant details updated successfully.",
        "participant": updated,
    }
# --------------------------------------------------
# MARK PRESENT
# --------------------------------------------------
@app.post("/api/v1/participants/{roll_no}/present")
def mark_present(
    roll_no: str,
    request: AttendanceRequest,
):
    code = roll_no.strip()
    with get_connection() as conn:
        # Lock participant to prevent simultaneous updates.
        participant = conn.execute(
            """
            SELECT id, roll_no, in_premise, phone_no, child_name
            FROM participants
            WHERE roll_no = %s
            FOR UPDATE
            """,
            (code,),
        ).fetchone()
        if participant is None:
            raise HTTPException(
                status_code=404,
                detail="Participant not found",
            )
        # Check whether an attendance record already exists.
        existing = conn.execute(
            """
            SELECT
                id,
                participant_id,
                event_day,
                in_time,
                out_time
            FROM attendance_records
            WHERE participant_id = %s
              AND event_day = %s
            FOR UPDATE
            """,
            (participant["id"], request.event_day),
        ).fetchone()
        if existing:
            # Already present and still inside.
            # Treat repeated requests as successful and idempotent.
            if existing["out_time"] is None:
                conn.execute(
                    """
                    UPDATE participants
                    SET in_premise = TRUE,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (participant["id"],),
                )
                return {
                    "success": True,
                    "message": "Participant is already marked present.",
                    "already_marked": True,
                    "in_premise": True,
                    "attendance": existing,
                }
            # The student has already been dispersed.
            raise HTTPException(
                status_code=409,
                detail="This participant has already been dispersed for this event day.",
            )
        # Create attendance record.
        attendance = conn.execute(
            """
            INSERT INTO attendance_records
                (participant_id, event_day, in_time)
            VALUES (%s, %s, NOW())
            RETURNING
                id,
                participant_id,
                event_day,
                in_time,
                out_time
            """,
            (
                participant["id"],
                request.event_day,
            ),
        ).fetchone()
        # Update current location status.
        conn.execute(
            """
            UPDATE participants
            SET in_premise = TRUE,
                updated_at = NOW()
            WHERE id = %s
            """,
            (participant["id"],),
        )
    # Send only for a newly created attendance record, after the DB commit.
    whatsapp = send_doubletick_template(
        participant.get("phone_no"),
        DOUBLETICK_PRESENT_TEMPLATE,
    )
    return {
        "success": True,
        "message": "Attendance marked successfully.",
        "already_marked": False,
        "in_premise": True,
        "attendance": attendance,
        "whatsapp": whatsapp,
    }
# --------------------------------------------------
# MARK DISPERSAL
# --------------------------------------------------
@app.post("/api/v1/participants/{roll_no}/dispersal")
def mark_dispersal(
    roll_no: str,
    request: AttendanceRequest,
):
    code = roll_no.strip()
    with get_connection() as conn:
        # Lock participant during dispersal.
        participant = conn.execute(
            """
            SELECT id, roll_no, in_premise, phone_no, child_name
            FROM participants
            WHERE roll_no = %s
            FOR UPDATE
            """,
            (code,),
        ).fetchone()
        if participant is None:
            raise HTTPException(
                status_code=404,
                detail="Participant not found",
            )
        # Find today's open attendance record.
        existing = conn.execute(
            """
            SELECT
                id,
                participant_id,
                event_day,
                in_time,
                out_time
            FROM attendance_records
            WHERE participant_id = %s
              AND event_day = %s
            FOR UPDATE
            """,
            (
                participant["id"],
                request.event_day,
            ),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=409,
                detail="No attendance record exists. Mark the participant present first.",
            )
        # Prevent duplicate dispersal.
        if existing["out_time"] is not None:
            # Ensure the boolean remains consistent.
            conn.execute(
                """
                UPDATE participants
                SET in_premise = FALSE,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (participant["id"],),
            )
            return {
                "success": True,
                "message": "Dispersal was already recorded.",
                "already_dispersed": True,
                "in_premise": False,
                "attendance": existing,
            }
        # Record departure time.
        attendance = conn.execute(
            """
            UPDATE attendance_records
            SET out_time = NOW()
            WHERE id = %s
              AND out_time IS NULL
            RETURNING
                id,
                participant_id,
                event_day,
                in_time,
                out_time
            """,
            (existing["id"],),
        ).fetchone()
        if attendance is None:
            raise HTTPException(
                status_code=409,
                detail="Dispersal could not be recorded. Please retry.",
            )
        # Mark participant as outside the venue.
        conn.execute(
            """
            UPDATE participants
            SET in_premise = FALSE,
                updated_at = NOW()
            WHERE id = %s
            """,
            (participant["id"],),
        )
    # Send only for a newly recorded dispersal, after the DB commit.
    whatsapp = send_doubletick_template(
        participant.get("phone_no"),
        DOUBLETICK_DISPERSAL_TEMPLATE,
    )
    return {
        "success": True,
        "message": "Dispersal marked successfully.",
        "already_dispersed": False,
        "in_premise": False,
        "attendance": attendance,
        "whatsapp": whatsapp,
    }
# --------------------------------------------------
# PARTICIPANT ATTENDANCE HISTORY
# --------------------------------------------------
@app.get("/api/v1/participants/{roll_no}/attendance")
def get_attendance(roll_no: str):
    code = roll_no.strip()
    with get_connection() as conn:
        participant = conn.execute(
            """
            SELECT id, roll_no, child_name, in_premise
            FROM participants
            WHERE roll_no = %s
            """,
            (code,),
        ).fetchone()
        if participant is None:
            raise HTTPException(
                status_code=404,
                detail="Participant not found",
            )
        records = conn.execute(
            """
            SELECT
                ar.id,
                p.roll_no,
                p.child_name,
                ar.participant_id,
                ar.event_day,
                ar.in_time,
                ar.out_time,
                ar.created_at
            FROM attendance_records ar
            JOIN participants p
                ON p.id = ar.participant_id
            WHERE ar.participant_id = %s
            ORDER BY ar.event_day
            """,
            (participant["id"],),
        ).fetchall()
    return {
        "success": True,
        "participant": participant,
        "attendance": records,
    }
# --------------------------------------------------
# LIVE PREMISE SUMMARY
# --------------------------------------------------
@app.get("/api/v1/attendance/summary")
def attendance_summary():
    with get_connection() as conn:
        summary = conn.execute(
            """
            SELECT
                COUNT(*) AS total_participants,
                COUNT(*) FILTER (
                    WHERE in_premise = TRUE
                ) AS currently_inside,
                COUNT(*) FILTER (
                    WHERE in_premise = FALSE
                ) AS currently_outside
            FROM participants
            """
        ).fetchone()
    return {
        "success": True,
        "summary": summary,
    }
@app.post("/api/v1/participants/{roll_no}/photo")
async def upload_participant_photo(
    roll_no: str,
    file: UploadFile = File(...)
):
    code = roll_no.strip()
    if file.content_type not in [
        "image/jpeg",
        "image/png",
        "image/webp",
    ]:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG and WEBP images are allowed."
        )
    contents = await file.read()
    if not contents:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty."
        )
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Image must be smaller than 5 MB."
        )
    try:
        with get_connection() as conn:
            participant = conn.execute(
                """
                SELECT id, roll_no
                FROM participants
                WHERE roll_no = %s
                FOR UPDATE
                """,
                (code,)
            ).fetchone()
            if participant is None:
                raise HTTPException(
                    status_code=404,
                    detail="Participant not found."
                )
            # Upload to Cloudinary.
            upload_result = cloudinary.uploader.upload(
                contents,
                folder="inaac/participants",
                public_id=f"participant_{participant['id']}",
                overwrite=True,
                resource_type="image",
            )
            image_url = upload_result["secure_url"]
            public_id = upload_result["public_id"]
            # Save the permanent participant photo.
            conn.execute(
                """
                UPDATE participants
                SET image_url = %s,
                    cloudinary_public_id = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (
                    image_url,
                    public_id,
                    participant["id"],
                )
            )
        return {
            "success": True,
            "message": "Participant photo updated successfully.",
            "roll_no": code,
            "image_url": image_url,
            "cloudinary_public_id": public_id,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Photo upload failed: {str(error)}"
        )
    finally:
        await file.close()
# ==================================================
# ADMIN AUTHENTICATION AND DASHBOARD
# ==================================================
class AdminLoginRequest(BaseModel):
    username: str
    password: str
ADMIN_TOKEN_TTL_SECONDS = 8 * 60 * 60
def create_admin_token(username: str) -> str:
    if not ADMIN_TOKEN_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Admin authentication is not configured."
        )
    payload = {
        "username": username,
        "exp": int(time.time()) + ADMIN_TOKEN_TTL_SECONDS
    }
    payload_bytes = json.dumps(
        payload,
        separators=(",", ":")
    ).encode("utf-8")
    encoded_payload = base64.urlsafe_b64encode(
        payload_bytes
    ).decode("utf-8").rstrip("=")
    signature = hmac.new(
        ADMIN_TOKEN_SECRET.encode("utf-8"),
        encoded_payload.encode("utf-8"),
        hashlib.sha256
    ).digest()
    encoded_signature = base64.urlsafe_b64encode(
        signature
    ).decode("utf-8").rstrip("=")
    return f"{encoded_payload}.{encoded_signature}"
def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(admin_security)
):
    if not ADMIN_USERNAME or not ADMIN_PASSWORD or not ADMIN_TOKEN_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Admin authentication is not configured."
        )
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Admin authentication required."
        )
    token = credentials.credentials
    try:
        encoded_payload, encoded_signature = token.split(".")
        expected_signature = hmac.new(
            ADMIN_TOKEN_SECRET.encode("utf-8"),
            encoded_payload.encode("utf-8"),
            hashlib.sha256
        ).digest()
        supplied_signature = base64.urlsafe_b64decode(
            encoded_signature + "=" * (-len(encoded_signature) % 4)
        )
        if not hmac.compare_digest(
            expected_signature,
            supplied_signature
        ):
            raise ValueError("Invalid signature")
        payload_bytes = base64.urlsafe_b64decode(
            encoded_payload + "=" * (-len(encoded_payload) % 4)
        )
        payload = json.loads(payload_bytes.decode("utf-8"))
        if payload.get("username") != ADMIN_USERNAME:
            raise ValueError("Invalid username")
        if int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("Token expired")
        return payload["username"]
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired admin session."
        )
# --------------------------------------------------
# ADMIN LOGIN
# --------------------------------------------------
@app.post("/api/admin/login")
def admin_login(request: AdminLoginRequest):
    if not ADMIN_USERNAME or not ADMIN_PASSWORD or not ADMIN_TOKEN_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Admin authentication is not configured."
        )
    username_valid = hmac.compare_digest(
        request.username,
        ADMIN_USERNAME
    )
    password_valid = hmac.compare_digest(
        request.password,
        ADMIN_PASSWORD
    )
    if not username_valid or not password_valid:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin username or password."
        )
    token = create_admin_token(ADMIN_USERNAME)
    return {
        "success": True,
        "message": "Admin login successful.",
        "access_token": token,
        "token_type": "bearer",
        "expires_in": ADMIN_TOKEN_TTL_SECONDS
    }
# --------------------------------------------------
# VERIFY ADMIN SESSION
# --------------------------------------------------
@app.get("/api/admin/me")
def admin_me(admin: str = Depends(require_admin)):
    return {
        "success": True,
        "username": admin
    }
# --------------------------------------------------
# ADMIN LOGOUT
# --------------------------------------------------
@app.post("/api/admin/logout")
def admin_logout(admin: str = Depends(require_admin)):
    # The frontend should discard its stored access token.
    # This token will also expire automatically after 8 hours.
    return {
        "success": True,
        "message": "Logged out successfully."
    }
# --------------------------------------------------
# ADMIN DASHBOARD SUMMARY
# --------------------------------------------------
@app.get("/api/admin/dashboard")
def admin_dashboard(
    selected_date: date | None = Query(default=None, alias="date"),
    admin: str = Depends(require_admin)
):
    if selected_date is None:
        selected_date = datetime.now(
            ZoneInfo("Asia/Kolkata")
        ).date()
    with get_connection() as conn:
        summary = conn.execute(
            """
            WITH daily_attendance AS (
                SELECT
                    participant_id,
                    MIN(in_time) AS in_time,
                    MAX(out_time) AS out_time
                FROM attendance_records
                WHERE (in_time AT TIME ZONE 'Asia/Kolkata')::date = %s
                GROUP BY participant_id
            )
            SELECT
                COUNT(p.id) AS total_employees,
                COUNT(d.participant_id) AS present_today,
                COUNT(p.id) FILTER (
                    WHERE p.in_premise = TRUE
                ) AS currently_inside,
                COUNT(p.id) FILTER (
                    WHERE d.participant_id IS NULL
                ) AS absent_today
            FROM participants p
            LEFT JOIN daily_attendance d
                ON d.participant_id = p.id
            """,
            (selected_date,)
        ).fetchone()
    return {
        "success": True,
        "date": selected_date.isoformat(),
        "summary": summary
    }
# --------------------------------------------------
# ADMIN EMPLOYEE ATTENDANCE TABLE
# --------------------------------------------------
@app.get("/api/admin/employees")
def admin_employees(
    selected_date: date | None = Query(default=None, alias="date"),
    admin: str = Depends(require_admin)
):
    if selected_date is None:
        selected_date = datetime.now(
            ZoneInfo("Asia/Kolkata")
        ).date()
    with get_connection() as conn:
        employees = conn.execute(
            """
            WITH daily_attendance AS (
                SELECT
                    participant_id,
                    MIN(in_time) AS in_time,
                    MAX(out_time) AS out_time
                FROM attendance_records
                WHERE (in_time AT TIME ZONE 'Asia/Kolkata')::date = %s
                GROUP BY participant_id
            )
            SELECT
                p.id,
                p.roll_no,
                p.child_name,
                p.phone_no,
                p.email,
                p.school_name,
                p.city,
                p.state,
                p.region,
                p.grade,
                p.team_no,
                p.group_no,
                p.image_url,
                p.in_premise,
                d.in_time,
                d.out_time,
                CASE
                    WHEN d.participant_id IS NULL
                        THEN 'absent'
                    WHEN d.out_time IS NULL
                        THEN 'present'
                    ELSE 'dispersed'
                END AS attendance_status
            FROM participants p
            LEFT JOIN daily_attendance d
                ON d.participant_id = p.id
            ORDER BY p.roll_no ASC
            """,
            (selected_date,)
        ).fetchall()
    return {
        "success": True,
        "date": selected_date.isoformat(),
        "total": len(employees),
        "employees": employees
    }