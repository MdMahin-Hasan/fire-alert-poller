const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const db = admin.firestore();

const BASE_URL = process.env.BASE_URL;

const CHECK_INTERVAL_MS = 20_000; // Check every 20 seconds
const TOTAL_RUN_MS = 4.5 * 60 * 1000; // Run for 4.5 minutes


// ===============================
// Check one device
// ===============================
async function checkDevice(deviceId) {
  const res = await axios.get(
    `${BASE_URL}/api/alerts/status`,
    {
      params: { deviceId },
    }
  );

  const { buzzerShouldSound } = res.data;

  const stateRef = db
    .collection("device_state")
    .doc(deviceId);

  const prev =
    (await stateRef.get()).data()?.buzzerShouldSound ?? false;


  // LOG 1: Check API result
  console.log(
    `[${deviceId}] buzzerShouldSound=${buzzerShouldSound}, previous=${prev}`
  );


  // Only send notification when state changes:
  // false -> true
  if (buzzerShouldSound && !prev) {

    const tokenDoc = await db
      .collection("device_tokens")
      .doc(deviceId)
      .get();

    const tokens =
      tokenDoc.data()?.tokens || [];


    // LOG 2: Check FCM tokens
    console.log(
      `[${deviceId}] FCM tokens found=${tokens.length}`
    );


    if (tokens.length > 0) {

      const response =
        await admin.messaging().sendEachForMulticast({
          tokens,

          notification: {
            title: "Fire alert!",
            body:
              `Possible fire detected on ${deviceId} - please verify`,
          },

          data: {
            deviceId,
          },
        });


      // LOG 3: Check FCM sending result
      console.log(
        `[${deviceId}] FCM success=${response.successCount}, failure=${response.failureCount}`
      );

    } else {

      console.log(
        `[${deviceId}] No FCM tokens found`
      );
    }
  }


  // Save current state
  await stateRef.set({
    buzzerShouldSound,
  });
}


// ===============================
// Check all devices
// ===============================
async function checkAllDevices() {

  // Get all registered devices
  const snapshot = await db
    .collection("device_tokens")
    .get();

  for (const doc of snapshot.docs) {

    const deviceId = doc.id;

    try {

      await checkDevice(deviceId);

    } catch (error) {

      console.error(
        `[${deviceId}] Error checking device:`,
        error.message
      );
    }
  }
}


// ===============================
// Main loop
// ===============================
async function main() {

  console.log("Notification worker started");

  const startedAt = Date.now();

  while (
    Date.now() - startedAt < TOTAL_RUN_MS
  ) {

    try {

      await checkAllDevices();

    } catch (error) {

      console.error(
        "Error checking devices:",
        error.message
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, CHECK_INTERVAL_MS)
    );
  }

  console.log("Notification worker finished");
}


main();
