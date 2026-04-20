import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

/** Root data directory for MyPensieve */
export const MYPENSIEVE_DIR = path.join(HOME, ".mypensieve");

/** Config file path (read-only, mode 0444) */
export const CONFIG_PATH = path.join(MYPENSIEVE_DIR, "config.json");

/** Secrets directory (mode 0700) */
export const SECRETS_DIR = path.join(MYPENSIEVE_DIR, ".secrets");

/** Subdirectories under ~/.mypensieve/ */
export const DIRS = {
	root: MYPENSIEVE_DIR,
	projects: path.join(MYPENSIEVE_DIR, "projects"),
	persona: path.join(MYPENSIEVE_DIR, "persona"),
	logs: path.join(MYPENSIEVE_DIR, "logs"),
	logsErrors: path.join(MYPENSIEVE_DIR, "logs", "errors"),
	logsCost: path.join(MYPENSIEVE_DIR, "logs", "cost"),
	logsCron: path.join(MYPENSIEVE_DIR, "logs", "cron"),
	state: path.join(MYPENSIEVE_DIR, "state"),
	stateReminders: path.join(MYPENSIEVE_DIR, "state", "reminders"),
	sessionMeta: path.join(MYPENSIEVE_DIR, "state", "session-meta"),
	secrets: SECRETS_DIR,
	metaSkills: path.join(MYPENSIEVE_DIR, "meta-skills"),
} as const;

/** Agent persona file path */
export const AGENT_PERSONA_PATH = path.join(MYPENSIEVE_DIR, "persona", "agent.md");

/** Operator persona file path */
export const OPERATOR_PERSONA_PATH = path.join(MYPENSIEVE_DIR, "persona", "operator.md");

/** Wizard progress file for resumability */
export const INIT_PROGRESS_PATH = path.join(MYPENSIEVE_DIR, ".init-progress.json");

/** Pi's directories that we read from (not write to) */
export const PI_DIRS = {
	root: path.join(HOME, ".pi", "agent"),
	extensions: path.join(HOME, ".pi", "agent", "extensions"),
	mypensieveExtensions: path.join(HOME, ".pi", "agent", "extensions", "mypensieve"),
	agents: path.join(HOME, ".pi", "agent", "agents"),
	skills: path.join(HOME, ".pi", "agent", "skills"),
	sessions: path.join(HOME, ".pi", "agent", "sessions"),
	auth: path.join(HOME, ".pi", "agent", "auth.json"),
} as const;
