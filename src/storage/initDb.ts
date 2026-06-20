import { config } from "../config.js";
import { closeDatabase, initializeDatabase } from "./db.js";
import { logger } from "../utils/logger.js";

initializeDatabase();
logger.info("DB", "Database initialized", { path: config.databasePath });
closeDatabase();
