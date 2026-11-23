// Stands in for the `claude` command: logs the call and does to ~/.claude.json
// what `claude mcp add|remove --scope user` does.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const home = os.homedir();
fs.appendFileSync(path.join(home, "claude-calls.log"), JSON.stringify(args) + "\n");
const file = path.join(home, ".claude.json");
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.mcpServers ??= {};
if (args[0] === "mcp" && args[1] === "remove") {
  const name = args[args.length - 1];
  if (!config.mcpServers[name]) {
    console.error(`No user-scoped MCP server found with name: ${name}`);
    process.exit(1);
  }
  delete config.mcpServers[name];
} else if (args[0] === "mcp" && args[1] === "add") {
  const dash = args.indexOf("--");
  const name = args[dash - 1];
  const [command, ...rest] = args.slice(dash + 1);
  config.mcpServers[name] = { type: "stdio", command, args: rest, env: {} };
} else {
  console.error("unexpected call");
  process.exit(2);
}
fs.writeFileSync(file, JSON.stringify(config, null, 2));
