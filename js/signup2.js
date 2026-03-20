
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const FIREBASE_WORKER_URL = 'https://snyaptium-firebase.craftedgamz.workers.dev';

let firebaseConfig;

async function loadFirebaseConfig() {
  try {
    const res = await fetch(FIREBASE_WORKER_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'snyaptium-firebase'
      }
    });
    
    if (!res.ok) {
      throw new Error('Failed to fetch Firebase config');
    }
    
    const data = await res.json();
    firebaseConfig = data.firebaseConfig;
    console.log('✅ Firebase config loaded successfully');
  } catch (error) {
    console.error('❌ Error loading Firebase config:', error);
    throw error;
  }
}

await loadFirebaseConfig();

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

auth.onAuthStateChanged((user) => {
  if (user) window.location.href = 'chat.html';
});

window.handleLogin = async function(e) {
  e.preventDefault();
  hideError();
  
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  
  btn.disabled = true; btn.textContent = 'Signing in...';
  
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = 'chat.html';
  } catch (error) {
    let msg = 'Failed to sign in. Please try again.';
    if (error.code === 'auth/user-not-found') msg = 'No account found with this email.';
    else if (error.code === 'auth/wrong-password') msg = 'Incorrect password.';
    else if (error.code === 'auth/invalid-email') msg = 'Invalid email address.';
    showError(msg);
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

window.handleSignup = async function(e) {
  e.preventDefault();
  hideError();
  
  const name = document.getElementById('signupName').value;
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const btn = document.getElementById('signupBtn');
  
  btn.disabled = true; btn.textContent = 'Creating account...';
  
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    await updateProfile(user, { displayName: name });
    await setDoc(doc(db, 'users', user.uid), {
      name, email, createdAt: serverTimestamp()
    });
    
    window.location.href = 'chat.html';
  } catch (error) {
    let msg = 'Failed to create account. Please try again.';
    if (error.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
    else if (error.code === 'auth/invalid-email') msg = 'Invalid email address.';
    else if (error.code === 'auth/weak-password') msg = 'Password should be at least 6 characters.';
    showError(msg);
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}