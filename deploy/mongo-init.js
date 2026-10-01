// Runs once, on the first start of an empty data volume (official mongo image entrypoint).
// Creates a least-privilege application user for the API.
const appDb = db.getSiblingDB(process.env.MONGO_APP_DB || "noble");
appDb.createUser({
  user: process.env.MONGO_APP_USER,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: appDb.getName() }],
});
