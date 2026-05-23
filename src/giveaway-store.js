const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const GIVEAWAYS_PATH = path.join(DATA_DIR, "giveaways.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(GIVEAWAYS_PATH)) fs.writeFileSync(GIVEAWAYS_PATH, JSON.stringify({}, null, 2));
}

function readGiveaways() {
  ensureStore();
  return JSON.parse(fs.readFileSync(GIVEAWAYS_PATH, "utf8"));
}

function writeGiveaways(giveaways) {
  ensureStore();
  fs.writeFileSync(GIVEAWAYS_PATH, JSON.stringify(giveaways, null, 2));
}

function getGiveaway(giveawayId) {
  return readGiveaways()[giveawayId] || null;
}

function setGiveaway(giveawayId, giveaway) {
  const giveaways = readGiveaways();
  giveaways[giveawayId] = giveaway;
  writeGiveaways(giveaways);
  return giveaway;
}

function updateGiveaway(giveawayId, updater) {
  const giveaways = readGiveaways();
  const current = giveaways[giveawayId];
  if (!current) return null;
  giveaways[giveawayId] = updater(current);
  writeGiveaways(giveaways);
  return giveaways[giveawayId];
}

function getActiveGiveaways() {
  return Object.values(readGiveaways()).filter((giveaway) => !giveaway.ended);
}

module.exports = {
  getActiveGiveaways,
  getGiveaway,
  readGiveaways,
  setGiveaway,
  updateGiveaway,
};
