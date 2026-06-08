/* ============================================================
   BACKEND CONFIG
   ------------------------------------------------------------
   To enable LIVE shared betting (everyone sees submissions
   instantly), paste your Firebase project config below.

   Setup (5 minutes, free):
     1. Go to https://console.firebase.google.com  ->  Add project
     2. Build  ->  Realtime Database  ->  Create database
        (start in "locked mode", then paste the rules from README)
     3. Project settings (gear icon)  ->  General  ->  "Your apps"
        ->  Web app (</>)  ->  register  ->  copy the firebaseConfig
     4. Replace the object below with your config and commit.

   Until a real databaseURL is filled in, the site runs in
   LOCAL mode: balances are saved in your browser and shared by
   downloading + committing data/betting.json.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyB6sfDCwwbSv23Oj_u2ltnNC8d8TNhhUZ8",
  authDomain: "worldcup2026bets.firebaseapp.com",
  databaseURL:
    "https://worldcup2026bets-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "worldcup2026bets",
  storageBucket: "worldcup2026bets.firebasestorage.app",
  messagingSenderId: "147238529297",
  appId: "1:147238529297:web:81d652bdd1c5b4a9be44b0",
};
