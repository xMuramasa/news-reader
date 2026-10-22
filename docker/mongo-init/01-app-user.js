// Creates the application user for news-api. Mounted into /docker-entrypoint-initdb.d of mongo:9.0.4, so it runs once,
// on first start with an empty data directory, in mongosh as the root user (MONGO_INITDB_ROOT_USERNAME/PASSWORD).
// Env (set on the mongo container):
//   MONGO_APP_PASSWORD  required
//   MONGO_APP_USER      default news_app
//   MONGO_APP_DB        default news
//
// Privileges: readWrite on the app database, plus `news_schema`, a role holding only `collMod` on that database.
// news-api re-applies its $jsonSchema validators with collMod on every start (apps/api/src/db.ts ensureSchema), and
// readWrite does not include collMod: without it the API starts once and then fails on every restart.
const appUser = process.env.MONGO_APP_USER || "news_app";
const appPassword = process.env.MONGO_APP_PASSWORD;
const appDb = process.env.MONGO_APP_DB || "news";
const schemaRole = "news_schema";

if (!appPassword) {
  throw new Error("MONGO_APP_PASSWORD is not set; refusing to create " + appUser + " without a password");
}

const target = db.getSiblingDB(appDb);

const privileges = [{ resource: { db: appDb, collection: "" }, actions: ["collMod"] }];
if (target.getRole(schemaRole)) {
  target.updateRole(schemaRole, { privileges: privileges, roles: [] });
} else {
  target.createRole({ role: schemaRole, privileges: privileges, roles: [] });
}

const roles = [
  { role: "readWrite", db: appDb },
  { role: schemaRole, db: appDb },
];
if (target.getUser(appUser)) {
  target.updateUser(appUser, { pwd: appPassword, roles: roles });
  print("01-app-user: updated " + appUser + " on " + appDb);
} else {
  target.createUser({ user: appUser, pwd: appPassword, roles: roles });
  print("01-app-user: created " + appUser + " (readWrite + " + schemaRole + ") on " + appDb);
}
