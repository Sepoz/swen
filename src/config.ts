import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Feed = {
	name: string;
	url: string;
	category: string;
};

export type Config = {
	feeds: Feed[];
	source: string;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED = resolve(HERE, "..", "feeds.json");

export function resolveFeedsPath(override: string | undefined): string {
	if (override && override.length > 0) return resolve(process.cwd(), override);
	const cwdPath = resolve(process.cwd(), "feeds.json");
	try {
		readFileSync(cwdPath);
		return cwdPath;
	} catch {
		return BUNDLED;
	}
}

export function loadConfig(override?: string): Config {
	const path = resolveFeedsPath(override);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new Error(
			`Could not read feeds file at ${path}: ${err instanceof Error ? err.message : String(err)}`,
			{ cause: err },
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`Invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
			{ cause: err },
		);
	}

	if (!Array.isArray(parsed)) {
		throw new Error(`Expected ${path} to contain a JSON array of feed entries.`);
	}

	const feeds: Feed[] = parsed.map((entry, i) => {
		if (!entry || typeof entry !== "object") {
			throw new Error(`Feed entry #${i} in ${path} is not an object.`);
		}
		const e = entry as { name?: unknown; url?: unknown; category?: unknown };
		if (typeof e.name !== "string" || e.name.length === 0) {
			throw new Error(`Feed entry #${i} in ${path} is missing a "name".`);
		}
		if (typeof e.url !== "string" || e.url.length === 0) {
			throw new Error(`Feed "${e.name}" in ${path} is missing a "url".`);
		}
		if (!URL.canParse(e.url)) {
			throw new Error(`Feed "${e.name}" has an invalid URL: ${e.url}`);
		}
		const category =
			typeof e.category === "string" && e.category.length > 0 ? e.category : "general";
		return { name: e.name, url: e.url, category };
	});

	if (feeds.length === 0) {
		throw new Error(`No feeds configured in ${path}.`);
	}

	return { feeds, source: path };
}
