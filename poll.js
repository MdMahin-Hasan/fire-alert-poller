const admin = require("firebase-admin");
const axios = require("axios");

console.log("POLL.JS STARTED");

// ===============================
// Firebase
// ===============================
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

console.log("FIREBASE INITIALIZED");

const db = admin.firestore();

console.log("FIRESTORE INITIALIZED");

// ===============================
// Configuration
// ===============================
const BASE_URL = process.env.BASE_URL;

const CHECK_INTERVAL_MS = 20 * 1000; // 20 seconds
const TOTAL_RUN_MS = 4.5 * 60 * 1000; // 4.5 minutes


// ===============================
// Check one device
// ===============================
async function checkDevice(deviceId) {
  try {
    console.log(`[${deviceId}] Checking API...`);

    const res = await axios.get(
      `${BASE_URL}/api/alerts/status`,
      {
        params: {
          deviceId: deviceId,
        },
        timeout: 10000,
      }
    );

    const { buzzerShouldSound } = res.data;

    const stateRef = db
      .collection("device_state")
      .doc(deviceId);

    const stateDoc = await stateRef.get();

    const prev =
      stateDoc.data()?.buzzerShouldSound ?? false;

    console.log(
      `[${deviceId}] buzzerShouldSound=${buzzerShouldSound}, previous=${prev}`
    );


    // ===============================
    // FIRE ALERT
    // ===============================
    if (buzzerShouldSound && !prev) {

      console.log(
        `[${deviceId}] FIRE ALERT DETECTED - preparing notification`
      );

      const tokenDoc = await db
        .collection("device_tokens")
        .doc(deviceId)
        .get();

      const tokens =
        tokenDoc.data()?.tokens || [];

      console.log(
        `[${deviceId}] FCM tokens found=${tokens.length}`
      );


      if (tokens.length > 0) {

        const response =
          await admin.messaging().sendEachForMulticast({

            tokens: tokens,

            notification: {
              title: "🔥 Fire Alert!",
              body:
                `Possible fire detected on ${deviceId} - please verify`,
            },

            data: {
              deviceId: deviceId,
              type: "fire_alert",
            },
          });


        console.log(
          `[${deviceId}] FCM success=${response.successCount}, failure=${response.failureCount}`
        );


        // Show individual errors if any
        if (response.failureCount > 0) {

          response.responses.forEach(
            (result, index) => {

              if (!result.success) {

                console.error(
                  `[${deviceId}] FCM error for token ${index}:`,
                  result.error?.message
                );
              }
            }
          );
        }

      } else {

        console.log(
          `[${deviceId}] No FCM tokens found`
        );
      }
    }


    // ===============================
    // Save current state
    // ===============================
    await stateRef.set({
      buzzerShouldSound: buzzerShouldSound,
    });

  } catch (error) {

    console.error(
      `[${deviceId}] ERROR:`,
      error.response?.data ||
      error.message
    );
  }
}


// ===============================
// Check all devices
// ===============================
async function checkAllDevices() {

  console.log("Checking all devices...");

  const snapshot = await db
    .collection("device_tokens")
    .get();

  console.log(
    `Devices found: ${snapshot.size}`
  );

  for (const doc of snapshot.docs) {

    await checkDevice(doc.id);
  }
}


// ===============================
// Main worker
// ===============================
async function main() {

  console.log("=================================");
  console.log("Notification worker started");
  console.log("=================================");

  if (!BASE_URL) {
    throw new Error("BASE_URL is not configured");
  }

  const startedAt = Date.now();

  while (
    Date.now() - startedAt < TOTAL_RUN_MS
  ) {

    console.log("");
    console.log("CHECKING DEVICES...");

    await checkAllDevices();

    console.log(
      "Waiting 20 seconds before next check..."
    );

    await new Promise((resolve) =>
      setTimeout(resolve, CHECK_INTERVAL_MS)
    );
  }

  console.log("");
  console.log("=================================");
  console.log("Notification worker finished");
  console.log("=================================");
}


// ===============================
// Start
// ===============================
main().catch((error) => {

  console.error(
    "FATAL ERROR:",
    error
  );

  process.exit(1);
});
