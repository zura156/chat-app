import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {StreamChat} from "stream-chat";

// Using import instead of require for CORS
import cors = require("cors");
const corsHandler = cors({origin: true});

const serverStreamClient = StreamChat.getInstance(
    functions.config().stream.key,
    functions.config().stream.secret
);

admin.initializeApp();

export const createStreamUser = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    const {user} = req.body;

    if (!user) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Bad request"
      );
    }

    try {
      await serverStreamClient.upsertUser({
        id: user.uid,
        email: user.email,
      });

      res.status(200).send({message: "User created"});
    } catch (error) {
      throw new functions.https.HttpsError(
          "aborted",
          "Could not create Stream user"
      );
    }
  });
});
