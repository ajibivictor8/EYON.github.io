/*
  Frontend configuration:
  1. Replace SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY with your project's values.
  2. These are public browser values. NEVER put Paystack secret keys or Supabase service-role/secret keys here.
  3. Deploy the Edge Functions described in README.md before using deposits.
*/
const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";
const CONFIGURED = !SUPABASE_URL.includes("YOUR_PROJECT_REF") && !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");
const client = CONFIGURED && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

const $ = (id) => document.getElementById(id);
$("year").textContent = new Date().getFullYear();

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 4000);
}
function setStatus(message) { $("auth-status").textContent = message; }
function naira(kobo) {
  return new Intl.NumberFormat("en-NG", {style:"currency", currency:"NGN"}).format(Number(kobo || 0) / 100);
}
function requireClient() {
  if (!client) throw new Error("Supabase is not configured yet. Follow the setup instructions in README.md.");
}
async function currentUser() {
  requireClient();
  const {data, error} = await client.auth.getUser();
  if (error) throw error;
  return data.user;
}
async function refreshAccount() {
  if (!client) { setStatus("Setup required: configure Supabase in app.js."); return; }
  const {data: {session}} = await client.auth.getSession();
  const signedIn = !!session;
  $("signout-btn").classList.toggle("hidden", !signedIn);
  $("signin-btn").classList.toggle("hidden", signedIn);
  $("signup-btn").classList.toggle("hidden", signedIn);
  if (!signedIn) {
    setStatus("Not signed in.");
    $("wallet-balance").textContent = "Sign in to view";
    $("transactions").innerHTML = '<li class="muted">Sign in to view transactions.</li>';
    return;
  }
  setStatus("Signed in as " + session.user.email);
  await refreshWallet();
}
async function refreshWallet() {
  const {data, error} = await client.rpc("get_my_wallet_summary");
  if (error) throw error;
  const summary = Array.isArray(data) ? data[0] : data;
  $("wallet-balance").textContent = naira(summary?.balance_kobo || 0);
  const {data: rows, error: txError} = await client.from("wallet_transactions")
    .select("id,kind,amount_kobo,status,created_at")
    .order("created_at", {ascending:false}).limit(10);
  if (txError) throw txError;
  $("transactions").replaceChildren();
  if (!rows?.length) {
    $("transactions").innerHTML = '<li class="muted">No transactions yet.</li>';
    return;
  }
  for (const row of rows) {
    const li = document.createElement("li");
    const date = new Date(row.created_at).toLocaleString();
    li.textContent = `${date} · ${row.kind} · ${naira(row.amount_kobo)} · ${row.status}`;
    $("transactions").appendChild(li);
  }
}
$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    requireClient();
    const {error} = await client.auth.signInWithPassword({email:$("email").value.trim(), password:$("password").value});
    if (error) throw error;
    await refreshAccount();
    toast("Signed in successfully.");
  } catch (e) { setStatus(e.message); }
});
$("signup-btn").addEventListener("click", async () => {
  try {
    requireClient();
    const {data, error} = await client.auth.signUp({email:$("email").value.trim(), password:$("password").value});
    if (error) throw error;
    setStatus(data.session ? "Account created." : "Check your email to confirm your account, then sign in.");
    await refreshAccount();
  } catch (e) { setStatus(e.message); }
});
$("signout-btn").addEventListener("click", async () => {
  try { const {error} = await client.auth.signOut(); if (error) throw error; await refreshAccount(); }
  catch(e) { toast(e.message); }
});
$("deposit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    requireClient();
    await currentUser();
    const amountNaira = Number($("deposit-amount").value);
    if (!Number.isSafeInteger(amountNaira) || amountNaira < 100) throw new Error("Enter a whole-naira amount of at least ₦100.");
    const {data, error} = await client.functions.invoke("create-deposit", {body:{amount_naira:amountNaira}});
    if (error) throw error;
    if (!data?.authorization_url) throw new Error(data?.error || "Could not start payment.");
    window.location.assign(data.authorization_url);
  } catch(e) { toast(e.message || "Deposit could not be started."); }
});

// Refresh after a customer returns from the payment page. The URL is not proof of payment.
(async () => {
  if (!client) { setStatus("Setup required: configure Supabase in app.js."); return; }
  client.auth.onAuthStateChange(() => { refreshAccount().catch(e => setStatus(e.message)); });
  const params = new URLSearchParams(window.location.search);
  if (params.has("reference")) {
    toast("Payment submitted. Your wallet updates after the server verifies the payment.");
    history.replaceState({}, "", window.location.pathname + window.location.hash);
  }
  try { await refreshAccount(); } catch(e) { setStatus(e.message); }
})();
