# XDMoD Storage scripts:

> More XDMoD storage metric information can be found [here](https://open.xdmod.org/10.0/storage.html).

## storage.py:

This script queries all active coldfront allocations and matches them with various storage platform API requests for XDMoD ingestion.

This script requires [Coldfront](https://github.com/ubccr/coldfront) as your project allocation system, it should be ran on your Coldfront host.

### Supported platforms are:

- Vast
- Panasas

Usage instructions can be found by running `python3 storage.py -h`

Configuration can be done with cli args and env variables, or with a config.ini file (see -h flag). Cron should be used to run this script daily.

Output files are named by date of creation and will be overwritten if ran multiple times in a day. XDMoD will need access to this directory for ingesting, outputting to shared storage is recommended.
