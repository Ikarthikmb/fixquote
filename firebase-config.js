// ── FixQuote – Firebase Configuration ────────────────────────────────────────
//
// SETUP STEPS (5 minutes):
//
// 1. Go to https://console.firebase.google.com → Create project → name it "fixquote"
// 2. Project Settings (gear icon) → General → "Your apps" → Add Web App → Register
//    Copy the apiKey and projectId below.
// 3. Authentication → Sign-in method → Enable "Email/Password" and "Google"
// 4. Firestore Database → Create database → Start in production mode
//    Paste these security rules:
//      rules_version = '2';
//      service cloud.firestore {
//        match /databases/{database}/documents {
//          match /users/{uid}/{document=**} {
//            allow read, write: if request.auth != null && request.auth.uid == uid;
//          }
//        }
//      }
// 5. For Google Sign-In in the extension:
//    - Go to console.cloud.google.com → APIs & Services → Credentials
//    - Create OAuth 2.0 Client ID → Chrome Extension
//    - Set the extension ID (from chrome://extensions) as the Application ID
//    - Copy the client_id into GOOGLE_CLIENT_ID below
//
// ─────────────────────────────────────────────────────────────────────────────

window.FIREBASE_CONFIG = {
  apiKey:    "AIzaSyApXg3GoCDwx__PIquIQNB2iJeVaBm_gAk",
  projectId: "fixquote-c56ec",
};

// Only needed for "Sign in with Google" button
window.GOOGLE_CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";
