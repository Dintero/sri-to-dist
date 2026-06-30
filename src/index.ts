import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { handleUpdatedHtml, toHtmlWithSri } from "./lib";

const main = async () => {
    try {
        const { values: options } = parseArgs({
            options: {
                input: { type: "string", short: "i" },
                output: { type: "string", short: "o" },
                "base-url": { type: "string", short: "b" },
                "no-remote": { type: "boolean", short: "n", default: false },
                verify: { type: "boolean", short: "v", default: false },
                version: { type: "boolean" },
                help: { type: "boolean", short: "h" },
            },
        });

        if (options.version) {
            console.log(version);
            process.exit(0);
        }

        if (options.help) {
            console.log(`HTML processing tool to add subresource integrity hashes

Usage:
  -i, --input <file>      Input HTML file (required)
  -o, --output <file>     Optional output HTML file
  -b, --base-url <url>    Optional base URL
  -n, --no-remote         Optional flag, no remote sri files allowed
  -v, --verify            Optional flag, verify hashes in input`);
            process.exit(0);
        }

        if (!options.input) {
            console.error(
                "error: required option '-i, --input <file>' not specified",
            );
            process.exit(1);
        }

        // Extract values
        const inputPath = options.input;
        const outputPath = options.output;
        const baseUrl = options["base-url"];
        const noRemote = options["no-remote"] ?? false;
        const verify = options.verify || false;

        // Read HTML file
        const htmlContent = fs.readFileSync(inputPath, "utf-8");

        const updatedHtml = await toHtmlWithSri(
            htmlContent,
            path.dirname(inputPath),
            baseUrl,
            noRemote,
            verify,
        );
        handleUpdatedHtml(process.stdout, outputPath, updatedHtml);
    } catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
    }
};

main().catch((error) => {
    console.error(`Error: ${error}`);
    process.exit(1);
});
