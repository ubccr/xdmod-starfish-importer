const config = {
  // General config:
  BLOCKED_USERNAMES: [
    "_apt",
    "root",
    "tcpdump",
    "uuidd",
    "syslog",
    "systemd-resolve",
    "systemd-network",
    "nobody",
    "www-data",
    "man",
    "pcpsync",
    "daemon",
  ],
  DEFAULT_PI: "none", // set to undefined to consider all users not mapped to a PI as a PI

  // Starfish config:
  STARFISH_URL: "",
  STARFISH_TOKEN: "",
  STARFISH_VOLUMES: [
    // this is a questionable way of mapping varying storage directory levels to the quota api query
    { volume: "user", path: "", depth: 1 },
    { volume: "projects", path: "", depth: 2 },
    { volume: "projects", path: "academic", depth: 2 },
  ],

  // Vast config:
  STORAGE_URL: "",
  STORAGE_ENDPOINT: "/api/quotas/",
  STORAGE_USERNAME: "",
  STORAGE_PASSWORD: "",
}
export default config
