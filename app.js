const https = require("https");
const express = require("express");
const fs = require("fs");
const app = express();
const uuid = require("uuid");
const getPort = require("get-port");
const WebSocket = require("ws");
const axios = require("axios");
const moment = require("moment");
require("dotenv").config();

const { log } = require("./lib/log");

const PORT = process.env.PORT || 60276;
app.set("port", PORT);

const { APIURL, AUTHKEY } = process.env;

const server = https.createServer(
  {
    cert: fs.readFileSync("certificate.pem"),
    key: fs.readFileSync("private.pem"),
  },
  app
);

console.info(`Listening on port ${PORT}`);

server.listen(PORT);
const wss = new WebSocket.Server({ server });

// sessions array contains the list sessions Objects (sessionId, port and configuration status)
sessions = [];

// sessionRoom contains the list of sessionId and their register clients
sessionRoom = [];

/**
 *  When a new client (Lab) connects with socket.
 *  It checks if connection is established with IDE send status to client on connection.
 *  If connection established it save this client in sessionRoom for communication.
 */
wss.on("connection", function connection(ws) {
  ws.on("message", function incoming(message) {

    if (message && !message.includes("*")) {
      console.log(`From CLIENT to IDE: ${moment().format()} ${message}`);
    }


    const clientUID = sessionRoom.find((sr) =>
      sr.clients.includes(ws._socket.remotePort)
    );
    let clientFind;
    if (clientUID) clientFind = sessions.find((s) => s.uid === clientUID.uid);

    // sending message to IDE from register client
    if (typeof message == "object") {
      if (clientUID) {
        if (clientFind) {
          clientFind.client.send(message);
        }
      }
    } else {
      // When lab open from web portal. lab connects with socket
      // Lab sends first message to register as a client to this socket session Id
      // First message will be like as session:1234-4567-8910-1212121212121
      if (message.startsWith("session:")) {
        const sessionId = message.substring(8).toLowerCase().trim();

        // Check if session room exist for this sessionId
        const res = sessionRoom.find((sr) => sr.uid === sessionId);

        const { remotePort } = ws._socket;

        // If its the first client of this sessionId. Push these details in session Room array
        if (!res) {
          sessionRoom.push({
            uid: sessionId,
            clients: [remotePort],
            rawClients: [ws],
          });
        } else {
          // else push new client detail in session Room for this client
          if (!res.clients.includes(remotePort)) {
            res.clients.push(remotePort);
            res.rawClients.push(ws);
          }
        }
      } else if (message === "status") {
        // This sends the status to client of socketId is configured with IDE or not
        // If socket connection is configured with IDE it will send true else false
        if (clientUID) {
          if (clientFind) {
            ws.send(`status: ${clientFind.configured ? "true" : "false"}`);
            const { configured, lastframe } = clientFind;
            if (configured && lastframe) {
              ws.send(lastframe);
            }
          } else {
            ws.send("status:false");
          }
        } else {
          ws.send("status:false");
        }
      } else {
        // if connection is estalished send messages from clients to IDE
        if (clientUID) {
          if (clientFind && clientFind.client) {
            if (clientFind.readyState === clientFind.OPEN) {  
              clientFind.client.send(message);
            }
          }
        }
      }
    }
  });
});

/**
 * Get new session ID and port for a device acquire by user.
 * Push this session detail in sessions Array.
 * Backend call this API.
 */
app.get("/getSession", async (req, res) => {
  debugger;
  const freeport = await getPort();
  const guid = uuid.v4();
  currentSession = {
    uid: guid,
    port: freeport,
    configured: false,
    client: null,
    lastframe: undefined,
    createdAt: new Date(),
  };

  sessions.push(currentSession);
  res.status(200).send(JSON.stringify(currentSession));
  log(
    `Get session API called from backend returned port **${freeport}** and guid: **${guid}**`
  );
});

/**
 * Remove socket connection for device release by user.
 * Controller call this API.
 */

app.get("/removeSession/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  log(`Remove session API called for session: **${sessionId}**`);
  cleanupSession(sessionId);
  res.send("OK");
});

/**
 * Configuring socket session and establish its connection.
 * Controller call this API.
 */

app.get("/configureSession/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  log(
    `Configure session API called from controller for session **${sessionId}**`
  );

  // Finding if this sessionId exists in sessions array
  const targetSession = sessions.find((s) => s.uid == sessionId.toLowerCase());

  if (!targetSession) {
    return res
      .status(400)
      .json({ message: "No session found against provided sessionId" });
  }

  const setupSession = () => {
    return new Promise((resolve, reject) => {
      // Establishing connection with IDE
      targetSession.client = new WebSocket(
        `ws://localhost:${targetSession.port}`,
        {
          perMessageDeflate: false,
        }
      );

      targetSession.client.on("error", function (error) {
        console.log(error);
        log(
          `Could not establish connection with IDE for session: **${sessionId}**`
        );
        reject(error);
      });

      // if connection is established with IDE
      targetSession.client.on("open", (open) => {
        resolve();
        log(
          `Connection established successfully for session: **${sessionId}**`
        );
        targetSession.configured = true;
        targetSession.client.send(`20 ${sessionId}`);
      });

      // Send message to all register clients with this socket session on message receive
      targetSession.client.on("message", function incoming(data) {
        if (typeof data == "object") {
          targetSession.lastframe = data;
        }

        connectedClients = sessionRoom.find((s) => s.uid == targetSession.uid);

        if (data && typeof data == "string" && JSON.stringify(data).length < 100) {
          console.log(`From IDE to CLIENT: ${moment().format()} ${data}`);
        }

        // sending data to all clients of a register socket connection
        if (connectedClients) {
          const cc = connectedClients.rawClients;
          for (i = 0; i < cc.length; i++) {
            const wclient = cc[i];   
            wclient.send(data);
          }
        }
      });
    });
  };

  try {
    // setTimeout(async () => {
    await setupSession();
    res.send("OK");
    // }, 3000);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

function cleanupSession(sessionId) {
  console.log(`Cleaning up session **${sessionId}**`);
  const removeSession = sessions.find((s) => s.uid == sessionId);
  if (removeSession) {
    log(`Removing session **${removeSession.uid}**`);

    // closing socket connection of a sessionId
    if (removeSession.client) {
      removeSession.client.close();
      removeSession.client.terminate();
    }

    // Remove sessionID from sessions array
    sessions.splice(sessions.indexOf(removeSession), 1);

    // Remove register clients of this sessionId from sessionRoom array
    sessionRoom.splice(
      sessionRoom.findIndex((x) => x.uid === sessionId),
      1
    );
  } else {
    log(`Session GUID **${sessionId}** already cleaned up`);
  }
}

app.get("/greet", function (res, req) {
  req.status(200).send("Hello from SOFY.AI");
});

/**
 *  Function check the remaining time of acquired devices session by calling an API.
 *  If session time is finished or expired it calls cleanupSession function to clear the session.
 */
async function checkCleanupRequired() {
  console.log("Active sessions:\n");
  // console.log("Checking whether cleanup is required or not ...");
  sessions.forEach(async (element) => {
    const { uid: sessionId, createdAt, configured } = element;

    if (moment().diff(moment(createdAt), 'minutes') >= 2 && !configured) {
      log(`Session: ${sessionId} is not configured in last 2 minutes, so removing it.`)
      cleanupSession(sessionId);
      return;
    }

    const url = `${APIURL}api/BotManagement/getSessionRemainingTime?SessionGUID=${sessionId}`;

    try {
      // get sessionId status and expire time from backend API
      const response = await axios.get(url, { headers: { SofyAuth: AUTHKEY } });
      const [sessionDetail] = response.data;
      if (!sessionDetail) {
        throw Error(
          `${url} Couldn't get data in getSessionRemainingTime API response ${JSON.stringify(response.data)}`
        );
      }

      const { RemainingTime, Expired } = sessionDetail;
      console.log(
        `Found sessionId: ${sessionId}, RemainingTime: ${RemainingTime}, Expired: ${Expired}`
      );
      if (RemainingTime <= 0 || Expired) {
        cleanupSession(sessionId);
      }
    } catch (error) {
      console.log(`Error in get session expire time function`);
      console.log(error.message);
    }
  });
  setTimeout(checkCleanupRequired, 30000);
}

checkCleanupRequired();
