// firebase-config.example.js
// ─────────────────────────────────────────────────────────
// This file is a template. Do NOT put real values here.
// For local development:
//   1. Copy this file to firebase-config.js
//   2. Fill in your values from Firebase Console
//   3. firebase-config.js is in .gitignore — it won't be committed
//
// For production (GitHub Pages):
//   Values are injected automatically via GitHub Actions secrets.
//   See .github/workflows/deploy.yml
// ─────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            "AIzaSyDQRDGO-kC7twaH7aNtFGsmrOJI7yEkq2g",
  authDomain:        "wikireels-1eb73.firebaseapp.com",
  projectId:         "wikireels-1eb73",
  storageBucket:     "wikireels-1eb73.firebasestorage.app",
  messagingSenderId: "1074310049117",
  appId:             "1:1074310049117:web:abd4238d72bb9c5d5c8cb4",
};

firebase.initializeApp(firebaseConfig);
