const admin = require("firebase-admin");
const axios = require("axios");
admin.initializeApp({
credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();
const BASE_URL = "https://fire-detection-backend-1.onrender.com";
const CHECK_INTERVAL_MS = 20_000; // check every 20 seconds
const TOTAL_RUN_MS = 4.5 * 60 * 1000; // loop for 4.5 min, under the 5-min cron gap
async function checkDevice(deviceId) {
const res = await axios.get(`${BASE_URL}/api/alerts/status`, { params: { deviceId } });
const { buzzerShouldSound } = res.data;
const stateRef = db.collection("device_state").doc(deviceId);
const prev = (await stateRef.get()).data()?.buzzerShouldSound ?? false;
if (buzzerShouldSound && !prev) {
const tokenDoc = await db.collection("device_tokens").doc(deviceId).get();
const tokens = tokenDoc.data()?.tokens || [];
if (tokens.length > 0) {
await admin.messaging().sendEachForMulticast({
tokens,
notification: {
title: "Fire alert!",
body: `Possible fire detected on ${deviceId} - please verify`,
},
data: { deviceId },
});
}
}
await stateRef.set({ buzzerShouldSound });
}
async function checkAllDevices() {
const snapshot = await db.collection("device_tokens").get();
const deviceIds = snapshot.docs.map((d) => d.id);
for (const deviceId of deviceIds) {
await checkDevice(deviceId).catch((e) => console.error(deviceId, e.message));
}
}
async function main() {
const startedAt = Date.now();
while (Date.now() - startedAt < TOTAL_RUN_MS) {
await checkAllDevices();
await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
}
}
main();

