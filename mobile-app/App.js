import React, { useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  Image,
  TextInput,
  Platform,
  TouchableOpacity,
  View,
  Modal,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
// IMPORTANT: Replace with your computer's Wi-Fi IPv4 address.
const API_BASE_URL = "https://inaccattendanceapp-production.up.railway.app";
const ALLOWED_QR_HOSTS = [
  "group1.inacc.in",
  "www.group1.inacc.in",
  "group2.inacc.in",
  "www.group2.inacc.in",
  "batch1.inacc.in",
  "batch2.inacc.in",
  "www.batch1.inacc.in",
  "www.batch2.inacc.in",
];
// Change this for the current INAAC event day.
const EVENT_DAY = 1;
function extractParticipantCode(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error("The QR code is empty.");
  }
  // Support plain roll numbers for testing.
  if (/^[A-Za-z0-9_-]{1,30}$/.test(value)) {
    return value;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("This QR code is not a valid participant URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_QR_HOSTS.includes(hostname)) {
    throw new Error(
      "This QR code is not from the INAAC itinerary website."
    );
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const code = parts[parts.length - 1];
  if (!code || !/^[A-Za-z0-9_-]{1,30}$/.test(code)) {
    throw new Error("No valid roll number was found in this QR code.");
  }
  return decodeURIComponent(code);
}
export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [screen, setScreen] = useState("home");
  const [rollNo, setRollNo] = useState("");
  const [participant, setParticipant] = useState(null);
  const [loading, setLoading] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState("");
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [dispersalStatus, setDispersalStatus] = useState(null);
  const [showDispersalConfirm, setShowDispersalConfirm] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [photoCameraOpen, setPhotoCameraOpen] = useState(false);
  const [capturedPhotoUri, setCapturedPhotoUri] = useState(null);
  const [photoMessage, setPhotoMessage] = useState("");
  const photoCameraRef = useRef(null);
  useEffect(() => {
    if (screen === "scanner") {
      setLastScanned("");
    }
  }, [screen]);
  // -----------------------------------------
  // PARTICIPANT SEARCH
  // -----------------------------------------
  async function lookupParticipant(code) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
      Alert.alert(
        "Enter roll number",
        "Please enter a participant roll number."
      );
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setParticipant(null);
    try {
      // 
      const response = await fetch(
        `${API_BASE_URL}/api/v1/participants/${encodeURIComponent(cleanCode)}?event_day=${EVENT_DAY}`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.detail || `Request failed (${response.status})`
        );
      }
      if (!data.success || !data.participant) {
        throw new Error(
          "Participant details were not returned by the server."
        );
      }
      setParticipant(data.participant);
      // Restore statuses if returned by the backend.
      setAttendanceStatus(
        data.participant.attendance_status || null
      );
      setDispersalStatus(
        data.participant.dispersal_status || null
      );
      setRollNo(data.participant.roll_no);
      setScreen("profile");
    } catch (error) {
      Alert.alert(
        "Could not fetch participant",
        `${error.message}\n\nCheck that the backend is running and API_BASE_URL contains your computer's Wi-Fi IP address.`
      );
    } finally {
      setLoading(false);
    }
  }
  // -----------------------------------------
  // MARK PRESENT
  // -----------------------------------------
  async function markPresent() {
    if (!participant?.roll_no || attendanceLoading) {
      return;
    }
    if (attendanceStatus === "present") {
      Alert.alert(
        "Already marked",
        "This participant is already marked PRESENT."
      );
      return;
    }
    if (dispersalStatus === "dispersed") {
      Alert.alert(
        "Already dispersed",
        "This participant has already been marked as dispersed."
      );
      return;
    }
    setAttendanceLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/participants/${encodeURIComponent(
          participant.roll_no
        )}/present`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            event_day: EVENT_DAY,
          }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.detail ||
          data.message ||
          `Could not mark present (${response.status}).`
        );
      }
      if (data.success === false) {
        throw new Error(
          data.message || "The server could not update attendance."
        );
      }
      setAttendanceStatus("present");
      Alert.alert(
        "Attendance recorded",
        `${participant.child_name || "Participant"} (Roll No. ${participant.roll_no}) has been marked PRESENT successfully.`
      );
    } catch (error) {
      Alert.alert(
        "Attendance update failed",
        error.message
      );
    } finally {
      setAttendanceLoading(false);
    }
  }
  // -----------------------------------------
  // DISPERSAL CONFIRMATION
  // -----------------------------------------
  function confirmDispersal() {
    if (!participant?.roll_no || attendanceLoading) return;
    if (attendanceStatus !== "present") {
      setActionMessage(
        "Please mark this participant PRESENT before recording dispersal."
      );
      return;
    }
    if (dispersalStatus === "dispersed") {
      setActionMessage("Dispersal has already been recorded.");
      return;
    }
    setActionMessage("");
    setShowDispersalConfirm(true);
  }
  // -----------------------------------------
  // SUBMIT DISPERSAL
  // -----------------------------------------
  async function submitDispersal() {
    if (!participant?.roll_no || attendanceLoading) return;
    setShowDispersalConfirm(false);
    setAttendanceLoading(true);
    setActionMessage("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/participants/${encodeURIComponent(
          participant.roll_no
        )}/dispersal`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            event_day: EVENT_DAY,
          }),
        }
      );
      const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            data.detail ||
            data.message ||
            `Dispersal failed (${response.status})`
          );
        }
        if (data.success === false) {
          throw new Error(
            data.message || "Dispersal could not be recorded."
          );
        }
        setDispersalStatus("dispersed");
        setActionMessage(
          `${participant.child_name} has been successfully marked as DISPERSED.`
        );
      } catch (error) {
        setActionMessage(
          `Dispersal failed: ${error.message}`
        );
      } finally {
        setAttendanceLoading(false);
      }
    }
  async function openParticipantPhotoCamera() {
    if (!participant?.roll_no || photoUploading) return;
    setPhotoMessage("");
    setCapturedPhotoUri(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setPhotoMessage(
          "Please allow camera access to capture the participant photo."
        );
        return;
      }
    }
    setPhotoCameraOpen(true);
  }
  async function captureParticipantPhoto() {
    if (!photoCameraRef.current || photoUploading) return;
    try {
      const photo = await photoCameraRef.current.takePictureAsync({
        quality: 0.75,
        skipProcessing: false,
      });
      if (!photo?.uri) {
        throw new Error("Camera did not return a photo.");
      }
      setCapturedPhotoUri(photo.uri);
      setPhotoCameraOpen(false);
      setPhotoMessage("");
    } catch (error) {
      setPhotoMessage(`Could not capture photo: ${error.message}`);
    }
  }
  async function saveParticipantPhoto() {
    if (!participant?.roll_no || !capturedPhotoUri || photoUploading) {
      return;
    }
    setPhotoUploading(true);
    setPhotoMessage("");
    try {
      const uploadUrl =
        `${API_BASE_URL}/api/v1/participants/${encodeURIComponent(
          participant.roll_no
        )}/photo`;
      let data = {};
      let status = 0;
      if (Platform.OS === "web") {
        // Browser upload
        const imageResponse = await fetch(capturedPhotoUri);
        if (!imageResponse.ok) {
          throw new Error("Unable to read captured photo.");
        }
        const blob = await imageResponse.blob();
        const formData = new globalThis.FormData();
        formData.append(
          "file",
          blob,
          `participant_${participant.roll_no}.jpg`
        );
        const result = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", uploadUrl);
          xhr.onload = () => {
            let responseData = {};
            try {
              responseData = JSON.parse(xhr.responseText);
            } catch {
              responseData = {};
            }
            resolve({
              status: xhr.status,
              data: responseData,
            });
          };
          xhr.onerror = () => reject(new Error("Network upload failed."));
          xhr.send(formData);
        });
        status = result.status;
        data = result.data;
      } else {
        // Native Android / iOS upload using Expo FileSystem
        const result = await FileSystem.uploadAsync(
          uploadUrl,
          capturedPhotoUri,
          {
            httpMethod: "POST",
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            fieldName: "file",
            mimeType: "image/jpeg",
          }
        );
        status = result.status;
        try {
          data = JSON.parse(result.body);
        } catch {
          data = {};
        }
      }
      if (status < 200 || status >= 300 || !data.success) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : typeof data.message === "string"
            ? data.message
            : JSON.stringify(data.detail || data);
        throw new Error(detail || `Upload failed (${status}).`);
      }
      setParticipant((previous) => ({
        ...previous,
        image_url: data.image_url,
        cloudinary_public_id: data.cloudinary_public_id,
      }));
      setCapturedPhotoUri(null);
      setPhotoMessage("Photo saved successfully.");
    } catch (error) {
      console.error("Photo upload error:", error);
      setPhotoMessage(
        `Photo upload failed: ${error.message || String(error)}`
      );
    } finally {
      setPhotoUploading(false);
    }
  }
  // -----------------------------------------
  // QR SCANNER
  // -----------------------------------------
  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          "Camera permission needed",
          "Allow camera access to scan participant QR codes."
        );
        return;
      }
    }
    setScreen("scanner");
  }
  function handleBarcode({ data }) {
    if (lastScanned || loading) {
      return;
    }
    setLastScanned(data);
    setScreen("home");
    try {
      const code = extractParticipantCode(data);
      lookupParticipant(code);
    } catch (error) {
      Alert.alert("Invalid QR code", error.message);
    }
  }
  // -----------------------------------------
  // NAVIGATION
  // -----------------------------------------
  function goHome() {
    // Clear previous participant details
    setParticipant(null);
    // Clear search field
    setRollNo("");
    // Reset attendance and dispersal states
    setAttendanceStatus(null);
    setDispersalStatus(null);
    // Clear confirmation modal and messages
    setShowDispersalConfirm(false);
    setActionMessage("");
    // Reset scanner state
    setLastScanned("");
    // Return to home screen
    setScreen("home");
    // Dismiss keyboard if open
    Keyboard.dismiss();
  }
  // -----------------------------------------
  // MAIN UI
  // -----------------------------------------
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="#F5F7FA"
      />
      {screen === "scanner" ? (
        // QR SCANNER SCREEN
        <View style={styles.scannerPage}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity
              onPress={goHome}
              style={styles.backButton}
            >
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>
              Scan Participant QR
            </Text>
            <Text style={styles.muted}>
              Align the QR code inside the frame
            </Text>
          </View>
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ["qr"],
              }}
              onBarcodeScanned={handleBarcode}
            />
            <View
              pointerEvents="none"
              style={styles.scanFrame}
            />
          </View>
          <Text style={styles.scannerHint}>
            Scan the QR code printed for the participant.
          </Text>
        </View>
      ) : (
        // HOME AND PROFILE SCREENS
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* BRANDING */}
          <View style={styles.brand}>
            <Image
              source={require("./asset/inacc_logo.png")}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <View style={styles.staffBadge}>
              <Text style={styles.staffBadgeText}>
                STAFF APP
              </Text>
            </View>
          </View>
          {screen === "home" ? (
            // HOME SCREEN
            <>
              <Text style={styles.sectionTitle}>
                Find Student
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Enter roll number (e.g. 001)"
                placeholderTextColor="#8993A4"
                value={rollNo}
                onChangeText={setRollNo}
                autoCapitalize="characters"
                returnKeyType="search"
                onSubmitEditing={() => lookupParticipant(rollNo)}
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => lookupParticipant(rollNo)}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    SEARCH STUDENT
                  </Text>
                )}
              </TouchableOpacity>
              <View style={styles.orRow}>
                <View style={styles.line} />
                <Text style={styles.orText}>OR</Text>
                <View style={styles.line} />
              </View>
              <TouchableOpacity
                style={styles.scanButton}
                onPress={openScanner}
              >
                <Text style={styles.scanIcon}>▦</Text>
                <Text style={styles.scanButtonText}>
                  SCAN QR CODE
                </Text>
                <Text style={styles.scanSub}>
                  Use back camera to scan participant QR
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            // PARTICIPANT PROFILE SCREEN
            <>
              <View style={styles.profileHeader}>
                <View style={styles.photoContainer}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      setPhotoMessage("");
                      setCapturedPhotoUri(null);
                      setPhotoCameraOpen(false);
                      setShowPhotoPreview(true);
                    }}
                  >
                    {participant?.image_url ? (
                      <Image
                        source={{ uri: participant.image_url }}
                        style={styles.profilePhoto}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {participant?.child_name?.charAt(0) || "?"}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editPhotoButton}
                    onPress={() => {
                      setPhotoMessage("");
                      setCapturedPhotoUri(null);
                      setPhotoCameraOpen(false);
                      setShowPhotoPreview(true);
                    }}
                    disabled={photoUploading}
                  >
                    <Text style={styles.editPhotoIcon}>✎</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.profileName}>
                  {participant?.child_name}
                </Text>
                <Text style={styles.profileCode}>
                  Roll No: {participant?.roll_no}
                </Text>
              </View>
              {/* PARTICIPANT DETAILS */}
              <View style={styles.detailsCard}>
                <Detail label="Email" value={participant?.email} />
                <Detail label="School" value={participant?.school_name} />
                <Detail label="City" value={participant?.city} />
                <Detail label="State" value={participant?.state} />
                <Detail label="Region" value={participant?.region} />
                <Detail label="Grade" value={participant?.grade} />
                <Detail label="Phone" value={participant?.phone_no} />
                <Detail label="Team No." value={participant?.team_no} />
                <Detail label="Group No." value={participant?.group_no} last />
              </View>
              {/* ATTENDANCE AND DISPERSAL BUTTONS */}
              <View style={styles.attendanceButtonRow}>
                {/* MARK PRESENT */}
                <TouchableOpacity
                  style={[
                    styles.attendanceButton,
                    styles.presentButton,
                    attendanceLoading && styles.attendanceButtonDisabled,
                    attendanceStatus === "present" &&
                      styles.selectedAttendanceButton,
                  ]}
                  onPress={markPresent}
                  disabled={
                    attendanceLoading ||
                    attendanceStatus === "present" ||
                    dispersalStatus === "dispersed"
                  }
                  activeOpacity={0.85}
                >
                  {attendanceLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.attendanceButtonText}>
                      {attendanceStatus === "present"
                        ? "PRESENT ✓"
                        : "MARK PRESENT"}
                    </Text>
                  )}
                </TouchableOpacity>
                {/* MARK DISPERSAL */}
                <TouchableOpacity
                  style={[
                    styles.attendanceButton,
                    styles.dispersalButton,
                    attendanceLoading && styles.attendanceButtonDisabled,
                    dispersalStatus === "dispersed" &&
                      styles.selectedAttendanceButton,
                  ]}
                  onPress={confirmDispersal}
                  disabled={
                    attendanceLoading ||
                    dispersalStatus === "dispersed"
                  }
                  activeOpacity={0.85}
                >
                  {attendanceLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.attendanceButtonText}>
                      {dispersalStatus === "dispersed"
                        ? "DISPERSED ✓"
                        : "MARK DISPERSAL"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
              {actionMessage !== "" && (
                <View style={styles.actionMessageBox}>
                  <Text style={styles.actionMessageText}>
                    {actionMessage}
                  </Text>
                </View>
              )}
              {/* BACK TO HOME */}
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={goHome}
              >
                <Text style={styles.secondaryButtonText}>
                  BACK TO HOME
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}
      <Modal
        visible={showPhotoPreview}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!photoUploading) {
            setShowPhotoPreview(false);
            setPhotoCameraOpen(false);
            setCapturedPhotoUri(null);
          }
        }}
      >
        <View style={styles.photoModalOverlay}>
          <View style={styles.photoModalCard}>
            <TouchableOpacity
              style={styles.photoModalClose}
              onPress={() => {
                setShowPhotoPreview(false);
                setPhotoCameraOpen(false);
                setCapturedPhotoUri(null);
              }}
              disabled={photoUploading}
            >
              <Text style={styles.photoModalCloseText}>×</Text>
            </TouchableOpacity>
            <Text style={styles.photoModalTitle}>
              {photoCameraOpen
                ? "Capture Student Photo"
                : capturedPhotoUri
                ? "Review Student Photo"
                : "Participant Photograph"}
            </Text>
            <Text style={styles.photoModalSubtitle}>
              {participant?.child_name} · Roll No. {participant?.roll_no}
            </Text>
            {photoCameraOpen ? (
              <>
                <View style={styles.photoCameraWrap}>
                  <CameraView
                    ref={photoCameraRef}
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    mode="picture"
                  />
                </View>
                <Text style={styles.photoModalHint}>
                  Position the student in the frame and tap Capture.
                </Text>
                <TouchableOpacity
                  style={styles.photoActionButton}
                  onPress={captureParticipantPhoto}
                >
                  <Text style={styles.photoActionButtonText}>
                    CAPTURE PHOTO
                  </Text>
                </TouchableOpacity>
              </>
            ) : capturedPhotoUri ? (
              <>
                <Image
                  source={{ uri: capturedPhotoUri }}
                  style={styles.photoPreviewImage}
                  resizeMode="cover"
                />
                <View style={styles.photoButtonRow}>
                  <TouchableOpacity
                    style={[
                      styles.photoActionButton,
                      styles.photoSecondaryButton,
                      styles.photoActionHalf
                    ]}
                    onPress={openParticipantPhotoCamera}
                    disabled={photoUploading}
                  >
                    <Text style={styles.photoActionButtonText}>
                      RETAKE
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.photoActionButton, styles.photoActionHalf]}
                    onPress={saveParticipantPhoto}
                    disabled={photoUploading}
                  >
                    {photoUploading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.photoActionButtonText}>
                        SAVE PHOTO
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {participant?.image_url ? (
                  <Image
                    source={{ uri: participant.image_url }}
                    style={styles.photoPreviewImage}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.photoPreviewPlaceholder}>
                    <Text style={styles.photoPreviewInitial}>
                      {participant?.child_name?.charAt(0) || "?"}
                    </Text>
                    <Text style={styles.photoPreviewPlaceholderText}>
                      No photograph added yet
                    </Text>
                  </View>
                )}
                {photoMessage !== "" && (
                  <Text style={styles.photoMessage}>
                    {photoMessage}
                  </Text>
                )}
                <TouchableOpacity
                  style={styles.photoActionButton}
                  onPress={openParticipantPhotoCamera}
                  disabled={photoUploading}
                >
                  <Text style={styles.photoActionButtonText}>
                    {participant?.image_url
                      ? "CAPTURE NEW PHOTO"
                      : "OPEN BACK CAMERA"}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.photoModalHint}>
                  Take a live photo using the phone's rear camera.
                </Text>
              </>
            )}
            {photoMessage !== "" &&
              (photoCameraOpen || capturedPhotoUri) && (
                <Text style={styles.photoMessage}>
                  {photoMessage}
                </Text>
              )}
          </View>
        </View>
      </Modal>
      <Modal
        visible={showDispersalConfirm}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDispersalConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <Text style={styles.modalIconText}>!</Text>
            </View>
            <Text style={styles.modalTitle}>
              Confirm Student Dispersal
            </Text>
            <Text style={styles.modalMessage}>
              Are you absolutely sure that this student has LEFT the venue?
            </Text>
            <View style={styles.modalStudent}>
              <Text style={styles.modalStudentName}>
                {participant?.child_name}
              </Text>
              <Text style={styles.modalStudentRoll}>
                Roll No: {participant?.roll_no}
              </Text>
            </View>
            <Text style={styles.modalWarning}>
              Please physically verify that the student has left
              the premises and has been handed over safely.
            </Text>
            <TouchableOpacity
              style={styles.confirmDispersalButton}
              onPress={submitDispersal}
              disabled={attendanceLoading}
            >
              <Text style={styles.confirmDispersalText}>
                YES, CONFIRM DISPERSAL
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelDispersalButton}
              onPress={() => setShowDispersalConfirm(false)}
              disabled={attendanceLoading}
            >
              <Text style={styles.cancelDispersalText}>
                NO, GO BACK
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
// -----------------------------------------
// PARTICIPANT DETAIL COMPONENT
// -----------------------------------------
function Detail({ label, value, last }) {
  return (
    <View
      style={[
        styles.detailRow,
        !last && styles.detailBorder,
      ]}
    >
      <Text style={styles.detailLabel}>
        {label}
      </Text>
      <Text style={styles.detailValue}>
        {value ?? "—"}
      </Text>
    </View>
  );
}
// -----------------------------------------
// STYLES
// -----------------------------------------
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },
  container: {
    padding: 22,
    paddingBottom: 40,
  },
  brand: {
    alignItems: "center",
    marginTop: 12,
    marginBottom: 34,
  },
  logoImage: {
    width: 125,
    height: 100,
    marginBottom: 12,
  },
  staffBadge: {
    marginTop: 8,
    backgroundColor: "#DDEFEA",
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 20,
  },
  staffBadgeText: {
    color: "#176B59",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 1.5,
  },
  sectionTitle: {
    color: "#142B4A",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 10,
  },
  input: {
    height: 54,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E0E9",
    borderRadius: 13,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#172B45",
  },
  primaryButton: {
    backgroundColor: "#173B63",
    borderRadius: 13,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  orRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 22,
    gap: 12,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: "#D9E0E9",
  },
  orText: {
    color: "#8793A4",
    fontWeight: "700",
    fontSize: 12,
  },
  scanButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#173B63",
    borderRadius: 16,
    alignItems: "center",
    padding: 22,
  },
  scanIcon: {
    color: "#173B63",
    fontSize: 38,
    marginBottom: 8,
  },
  scanButtonText: {
    color: "#173B63",
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 0.6,
  },
  scanSub: {
    color: "#78869A",
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },
  scannerPage: {
    flex: 1,
    padding: 18,
    backgroundColor: "#101A28",
  },
  scannerHeader: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 22,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  scannerTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "800",
    marginTop: 8,
  },
  muted: {
    color: "#B8C5D5",
    marginTop: 6,
    fontSize: 13,
  },
  cameraWrap: {
    flex: 1,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#25364B",
    marginVertical: 10,
  },
  scanFrame: {
    position: "absolute",
    width: 245,
    height: 245,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    borderRadius: 22,
    alignSelf: "center",
    top: "25%",
  },
  scannerHint: {
    color: "#D4DCE6",
    textAlign: "center",
    padding: 16,
    fontSize: 13,
  },
  profileHeader: {
    alignItems: "center",
    marginBottom: 22,
  },
  profilePhoto: {
    width: 112,
    height: 112,
    borderRadius: 56,
    marginBottom: 12,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: "#DCE6F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  avatarText: {
    fontSize: 46,
    fontWeight: "800",
    color: "#173B63",
  },
  profileName: {
    fontSize: 23,
    fontWeight: "900",
    color: "#142B4A",
    textAlign: "center",
  },
  profileCode: {
    color: "#6F7F93",
    marginTop: 5,
    fontWeight: "600",
  },
  detailsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  detailRow: {
    paddingVertical: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  detailBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#EDF0F4",
  },
  detailLabel: {
    color: "#758398",
    fontSize: 13,
    flex: 1,
  },
  detailValue: {
    color: "#172B45",
    fontSize: 13,
    fontWeight: "700",
    flex: 1.2,
    textAlign: "right",
  },
  // ATTENDANCE BUTTONS
  attendanceButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  attendanceButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    paddingVertical: 10,
  },
  presentButton: {
    backgroundColor: "#16865D",
  },
  dispersalButton: {
    backgroundColor: "#24558A",
  },
  attendanceButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  attendanceButtonDisabled: {
    opacity: 0.65,
  },
  selectedAttendanceButton: {
    borderWidth: 2,
    borderColor: "#142B4A",
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: "#173B63",
    borderRadius: 13,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  secondaryButtonText: {
    color: "#173B63",
    fontWeight: "800",
  },
  // DISPERSAL CONFIRMATION MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 25,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
  },
  modalIcon: {
    width: 55,
    height: 55,
    borderRadius: 30,
    backgroundColor: "#FFF0D5",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  modalIconText: {
    fontSize: 30,
    fontWeight: "900",
    color: "#B7791F",
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#142B4A",
    textAlign: "center",
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 14,
    color: "#53647A",
    textAlign: "center",
    lineHeight: 21,
  },
  modalStudent: {
    backgroundColor: "#F1F5F9",
    width: "100%",
    padding: 14,
    borderRadius: 12,
    marginTop: 18,
    alignItems: "center",
  },
  modalStudentName: {
    fontSize: 16,
    fontWeight: "900",
    color: "#173B63",
  },
  modalStudentRoll: {
    fontSize: 13,
    color: "#718096",
    marginTop: 5,
  },
  modalWarning: {
    color: "#B45309",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 19,
    marginVertical: 18,
  },
  confirmDispersalButton: {
    backgroundColor: "#24558A",
    width: "100%",
    height: 48,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmDispersalText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
  },
  cancelDispersalButton: {
    width: "100%",
    height: 45,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  cancelDispersalText: {
    color: "#173B63",
    fontWeight: "800",
    fontSize: 13,
  },
  // ACTION FEEDBACK
  actionMessageBox: {
    backgroundColor: "#EAF4EF",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  actionMessageText: {
    color: "#176B59",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
    photoContainer: {
    width: 112,
    height: 112,
    position: "relative",
    marginBottom: 12,
  },
  profilePhoto: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  editPhotoButton: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 34,
    height: 34,
    borderRadius: 18,
    backgroundColor: "#173B63",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  editPhotoIcon: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
    photoModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(8,18,32,0.78)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  photoModalCard: {
    width: "100%",
    maxWidth: 430,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 22,
    alignItems: "center",
  },
  photoModalClose: {
    alignSelf: "flex-end",
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  photoModalCloseText: {
    fontSize: 30,
    color: "#64748B",
  },
  photoModalTitle: {
    color: "#142B4A",
    fontSize: 19,
    fontWeight: "900",
  },
  photoModalSubtitle: {
    color: "#718096",
    fontSize: 12,
    marginTop: 6,
    marginBottom: 18,
  },
  photoPreviewImage: {
    width: 260,
    height: 300,
    maxWidth: "100%",
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
  },
  photoPreviewPlaceholder: {
    width: 260,
    height: 260,
    maxWidth: "100%",
    borderRadius: 14,
    backgroundColor: "#E8EEF5",
    alignItems: "center",
    justifyContent: "center",
  },
  photoPreviewInitial: {
    color: "#173B63",
    fontSize: 88,
    fontWeight: "900",
  },
  photoPreviewPlaceholderText: {
    color: "#64748B",
    fontSize: 13,
    marginTop: 8,
  },
  photoMessage: {
    color: "#176B59",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 12,
  },
  photoActionButton: {
    width: "100%",
    minHeight: 48,
    backgroundColor: "#173B63",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  photoActionButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  photoModalHint: {
    color: "#8290A3",
    fontSize: 11,
    textAlign: "center",
    marginTop: 10,
  },
  photoCameraWrap: {
    width: 280,
    height: 340,
    maxWidth: "100%",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#101A28",
  },
  photoButtonRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  photoSecondaryButton: {
    backgroundColor: "#64748B",
  },
  photoActionHalf: {
    flex: 1,
    minWidth: 0,
    width: undefined,
    alignItems: "center",
    justifyContent: "center",
  },
});