const WebSocket = require("ws");

const apiKey = process.env.AISSTREAM_API_KEY;
const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

ws.on("open", () => {
  ws.send(JSON.stringify({
    APIKey: apiKey,
    BoundingBoxes: [[[25.0, 54.0], [27.5, 57.5]]],
    FilterMessageTypes: ["PositionReport", "ShipStaticData", "StaticDataReport"]
  }));
  console.log("Connected to AISStream. Waiting for Hormuz messages...");
});

ws.on("message", data => {
  const msg = JSON.parse(data);
  console.log(msg.MessageType);
});

ws.on("error", err => console.error("AISStream error:", err.message));
