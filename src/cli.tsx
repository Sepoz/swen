#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import meow from "meow";
import { loadConfig } from "./config.js";
import App from "./app.js";

const cli = meow(
	`
  Usage
    $ swen

  Options
    --limit, -n   Max items to show across all feeds (default 50)
    --feeds, -f   Path to a JSON file with feed entries (default ./feeds.json)

  Feeds JSON format
    [
      { "name": "ANSA", "url": "https://...", "category": "general" },
      ...
    ]
`,
	{
		importMeta: import.meta,
		flags: {
			limit: { type: "number", shortFlag: "n", default: 50 },
			feeds: { type: "string", shortFlag: "f" },
		},
	},
);

try {
	const config = loadConfig(cli.flags.feeds);
	render(<App config={config} limit={cli.flags.limit} />);
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
