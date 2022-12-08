import fs, { writeFile } from "fs/promises"

import config from "./config.js"
import fetch from "node-fetch"
import { hideBin } from "yargs/helpers"
import https from "https"
import yargs from "yargs"

const agent = new https.Agent({
  rejectUnauthorized: false,
})

const args = yargs(hideBin(process.argv))
  .option("starfish", {
    alias: "s",
    description: "Specify a file to use instead of querying Starfish",
    type: "string",
  })
  .option("storage", {
    alias: "v",
    description: "Specify a file to use instead of querying Storage",
    type: "string",
  })
  .option("pi", {
    alias: "p",
    description: "Specify a file to map usernames to PIs",
    type: "string",
  })
  .option("quota-mapping", {
    alias: "q",
    description: "Specify a file to map storage directories to their owners",
    type: "string",
  })
  .option("resource", {
    alias: "r",
    description: "Specify a resource name",
    type: "string",
  })
  .option("output", {
    alias: "o",
    description: "Specify an output file",
    type: "string",
  })
  .usage("Usage: $0 [options]")
  // .epilog("")
  .help()
  .alias("help", "h").argv

const main = async () => {
  let currentDate = new Date().toISOString().split(".")[0] + "Z"

  let storage_res = (await storage()) ?? []
  if (storage_res.status === "error") console.error(storage_res)
  let user_map = (await quota_mapping()) ?? []
  if (user_map.status === "error") console.error(user_map)
  let starfish_res = await starfish()
  if (starfish_res?.status === "error") return starfish_res
  let pi_res = (await pi_mapping()) ?? []
  if (pi_res.status === "error") console.error(pi_res)

  // function to map storage paths to their owner
  let storage_quotas = []
  if (storage_res.status !== "error" && user_map.status !== "error") {
    storage_quotas = storage_res.map((val) => {
      let user = user_map.find((q) => "/" + q.vol_path.replace(":", "/") === val.path) ?? { username: "" } // (regex will only match the first ":")
      // * DEBUG: if (user.username === "") console.log(val, user)
      return { ...val, user: user.username }
    })
  }
  return starfish_res.map((val) => {
    let pi_map = pi_res.find((p) => p.users.find((u) => u === val.username)) ?? { pi: "unknown" } // assumes 1 pi per user, may need to change to a find all
    let storage_map = storage_quotas.find((s) => s.user === val.username && s.path.match(val.volume)) ?? {
      soft_limit: 0,
      hard_limit: 0,
      used_effective_capacity: 0,
    }

    return {
      resource: args.resource ?? "nfs",
      mountpoint: `/${val.volume}`,
      user: val.username ?? "unknown",
      pi: pi_map.pi,
      dt: currentDate,
      soft_threshold: storage_map.soft_limit,
      hard_threshold: storage_map.hard_limit,
      file_count: val.count,
      logical_usage: val.size_sum,
      physical_usage: storage_map.used_effective_capacity,
    }
  })
}

const storage = async () => {
  // TODO: simplify for additional storage platform API support
  // Required fields:
  // "path": "/user/username",
  // "soft_limit": 1,
  // "hard_limit": 1,
  // "used_capacity": 0,

  if (args.storage !== undefined) {
    // check if file input is used instead of query
    try {
      return JSON.parse(await fs.readFile(args.storage, "utf8"))
    } catch (error) {
      return { status: "error", message: "Storage file read error", error }
    }
  } else {
    if (
      config.STORAGE_URL === "" ||
      config.STORAGE_USERNAME === "" ||
      config.STORAGE_PASSWORD === "" ||
      config.STORAGE_ENDPOINT === ""
    )
      return {
        status: "error",
        message:
          "Quota information will be unavailable! Please set your storage connection details in the config.js file",
      }

    const url = config.STORAGE_URL + config.STORAGE_ENDPOINT
    const auth = Buffer.from(`${config.STORAGE_USERNAME}:${config.STORAGE_PASSWORD}`).toString("base64")
    const payload = { headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` }, agent }

    let response = await fetch(url, payload)
    let storage_res = await response.json()

    if (response.status === 200) return storage_res
    else return { status: "error", message: "Error querying storage API", error: storage_res }
  }
}

const starfish = async () => {
  // Returned fields:
  // "username": "username",
  // "count": "file count",
  // "size_sum": "size in Bytes",

  if (args.starfish) {
    // check if file input is used instead of query
    try {
      return JSON.parse(await fs.readFile(args.starfish, "utf8"))
    } catch (error) {
      return { status: "error", message: "Starfish file read error", error }
    }
  } else {
    if (config.STARFISH_URL === undefined || config.STARFISH_TOKEN === undefined)
      return {
        status: "error",
        message: "Please set your Starfish connection details in the config.js file or see --help for more options",
      }
    // SF async query | querys all volumes, groups by volume and username
    return await starfish_query(
      "/api/async/query/?queries=type%3Df&group_by=volume%2Cusername&line_delimiter=+",
      "POST"
    )
  }
}

const quota_mapping = async () => {
  // Function needed to find the user that owns each dir in the Storage query
  // The query may need to be edited depending on how deep your storage quotas are set
  // Returned fields:
  // "username": "username",
  // "vol_path": "full path"
  if (args["quota-mapping"]) {
    // check if file input is used instead of query
    try {
      return JSON.parse(await fs.readFile(args["quota-mapping"], "utf8"))
    } catch (error) {
      return { status: "error", message: "Quota mapping file read error", error }
    }
  } else {
    if (config.STARFISH_URL === undefined || config.STARFISH_TOKEN === undefined)
      return {
        status: "error",
        message:
          "Quota information will be unavailable! Please set your Starfish connection details in the config.js file or see --help for more options",
      }
    // SF user mapping query | returns all directories at a depth of 2
    //   STARFISH_VOLUMES: [{ volume: "user", path: "", depth: 1}, { volume: "projects", path: "", depth: 2}, { volume: "projects", path: "academic", depth: 2}],
    let tmp = await Promise.all(
      config.STARFISH_VOLUMES.map((val) =>
        starfish_query(
          `/api/async/query/?volumes_and_paths=${val.volume}%3A${val.path}&queries=type%3Dd+depth%3D${val.depth}&format=username&line_delimiter=+`,
          "POST"
        )
      )
    )
    return tmp.flat()
  }
}

const pi_mapping = async () => {
  // Example file:
  // [{
  //   pi: "blah",
  //   users: ["foo", "bar"]
  // }]

  if (args.pi) {
    // check if file input is used instead of query
    try {
      return JSON.parse(await fs.readFile(args.pi, "utf8"))
    } catch (error) {
      return { status: "error", message: "PI information will be unavailable! PI Mapping file read error", error }
    }
  }
  // TODO: add coldfront API query?
}

const starfish_query = async (query, method = "GET") => {
  const payload = {
    method: method,
    headers: {
      Authorization: `Bearer ${config.STARFISH_TOKEN}`,
      "Content-Type": "application/json",
    },
    agent,
  }
  let url = `${config.STARFISH_URL}${query}`
  let response = await fetch(url, payload)

  let response_json = response.body !== undefined ? await response.json() : response

  // for async queries:
  if (query.match("/api/async/query")) {
    let query_id = response_json.query_id ?? ""
    for (let x = 0; x <= 50; x++) {
      payload.method = "GET"
      let query_result = await fetch(`${config.STARFISH_URL}/api/async/query_result/${query_id}`, payload)
      let query_json = await query_result.json()
      if (query_result.status === 400) await new Promise((resolve) => setTimeout(resolve, 30000))
      else if (query_result.status === 200) return query_json
      else return { status: "error", message: "Starfish query error", query_json }
    }
  } else return { status: response.status, result: response_json }
}

let res = await main()

if (args.output !== undefined && res.status !== "error") {
  // output to file
  try {
    let data = new Uint8Array(Buffer.from(JSON.stringify(res, null, 4)))
    await writeFile(args.output, data)
  } catch (error) {
    console.error(error)
  }
} else console.log(JSON.stringify(res, null, 4))
