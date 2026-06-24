#!/usr/bin/env node
import { fileURLToPath } from "node:url"

process.stdout.write(`${fileURLToPath(new URL("../dist/plugin.js", import.meta.url))}\n`)
