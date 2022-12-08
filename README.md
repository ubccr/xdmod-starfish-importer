# About

xdmod-starfish-importer is a simple script written in JS that aggregates data from [StarFish](https://starfishstorage.com/) to prepare it for shredding and ingest into [XDMoD](https://open.xdmod.org/)

## Output

This script conforms to the output example found [here](https://open.xdmod.org/10.0/storage.html#example). Examples of how to shred and ingest the data can also be found on that page.

## Usage

> TODO: Compile into binary?

Copy and configure the config.js file, then run `node index.js -h` for more info

```bash
node index.js -r vast -o output.json -p pi_mapping.json
```

## Caveats

Quota information, ie: `soft_threshold & hard_threshold`, must come from your storage platform. Currently Vast is supported natively, other platforms can be added with respect to the required fields:

```js
// "path": "/user/username",
// "soft_limit": 1,
// "hard_limit": 1,
// "used_capacity": 0,
```

Running the script without querying the storage will result in "0" values for the following fields:

```js
{
    "soft_threshold": 0,
    "hard_threshold": 0,
    "physical_usage": 0
}
```

PI names will be "unknown" unless a mapping file is supplied with the `-p` or `--pi` flags. The future plan is to pull this data automatically from [ColdFront](https://github.com/ubccr/coldfront), but for now this is a manual process:

```js
[
    {
        pi: "blah",
        users: ["foo", "bar"]
    },
    ...
]
```
