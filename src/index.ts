import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { handleUpdatedHtml, toHtmlWithSri } from "./lib";
import { version } from '../package.json'

const main = async () => {
    try {
        // Set up command-line parser
        const program = new Command();
        program
            .version(version)
            .description(
                "HTML processing tool to add subresource integrity hashes",
            )
            .requiredOption("-i, --input <file>", "Input HTML file")
            .option("-o, --output <file>", "Optional output HTML file")
            .option("-b, --base-url <url>", "Optional base URL")
            .option("-n, --no-remote", "Optional flag, no remote sri files allowed")
            .option("-v, --verify", "Optional flag, verify hashes in input");

        program.parse(process.argv);
        const options = program.opts();

        // Extract values
        const inputPath = options.input;
        const outputPath = options.output;
        const baseUrl = options.baseUrl;
        const noRemote = options.noRemote || false;
        const verify = options.verify || false;

        // Read HTML file
        const htmlContent = fs.readFileSync(inputPath, "utf-8");

        const updatedHtml = await toHtmlWithSri(
            htmlContent,
            path.dirname(inputPath),
            baseUrl,
            noRemote,
            verify
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
