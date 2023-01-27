/*
  This file is for retroactivly changing the "PI" field on old files
  Useful if you did not run the main script with th -p flag 
*/

import fs, { writeFile } from "fs/promises"

import config from "./config.js"
import { hideBin } from "yargs/helpers"
import yargs from "yargs"

const args = yargs(hideBin(process.argv))
  .option("input", {
    alias: "i",
    description: "PI mapping file",
    type: "string",
  })
  .option("directory", {
    alias: "d",
    description: "Directory that will have all json files updated with the new PI mapping",
    type: "string",
  })
  .help()
  .alias("help", "h").argv

try {
  let files_unfiltered = await fs.readdir(args.directory, "utf8")
  let files = files_unfiltered.filter((val) => val.match(/\.json$/))
  let PI_mapping = JSON.parse(await fs.readFile(args.input, "utf8"))

  files.forEach(async (element) => {
    let current_file = JSON.parse(await fs.readFile(args.directory + element, "utf8"))
    let corrected_file = current_file
      .map((val) => {
        let new_PI = PI_mapping.find((pi) => {
          return pi.users.find((u) => u === val.user)
        }) ?? { pi: val.user }
        if (!config.BLOCKED_USERNAMES.includes(val.user)) return { ...val, pi: new_PI.pi }
      })
      .filter(Boolean)
    await fs.writeFile(args.directory + element, JSON.stringify(corrected_file, null, 2))
    console.log(`output file to ${args.directory + element}`)
  })
} catch (error) {
  console.error("Error reading Storage file: ")
  throw error
}
